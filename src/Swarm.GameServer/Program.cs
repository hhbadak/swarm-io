using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Swarm.Application;
using Swarm.Domain;

var builder = WebApplication.CreateBuilder(args);
var tokenSecret = Environment.GetEnvironmentVariable("SWARM_TOKEN_SECRET")
    ?? builder.Configuration["Swarm:TokenSecret"]
    ?? throw new InvalidOperationException("Swarm token secret is required.");
builder.Services.AddSingleton(new SwarmTokenService(tokenSecret));
builder.Services.AddSingleton<ArenaRoom>();
builder.Services.AddHostedService<ArenaLoopService>();

var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", (ArenaRoom room) => Results.Ok(new { status = "ready", players = room.PlayerCount }));
app.Map("/ws/arena", async (HttpContext context, SwarmTokenService tokens, ArenaRoom room) =>
{
    if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = StatusCodes.Status400BadRequest; return; }
    if (!tokens.TryValidatePurposePrefix(context.Request.Query["ticket"].ToString(), "match|", out var payload))
    { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return; }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var skinId = payload.Purpose.Split('|', 2).ElementAtOrDefault(1) ?? "starter";
    var connection = room.Connect(payload.PlayerId, payload.Nickname, skinId, socket);
    try { await ReceiveInputs(socket, room, payload.PlayerId, context.RequestAborted); }
    finally { room.Disconnect(connection); }
});
app.Run();

static async Task ReceiveInputs(WebSocket socket, ArenaRoom room, Guid playerId, CancellationToken cancellationToken)
{
    var buffer = new byte[2048];
    while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
    {
        var result = await socket.ReceiveAsync(buffer, cancellationToken);
        if (result.MessageType == WebSocketMessageType.Close)
        { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client closed", cancellationToken); return; }
        if (result.MessageType != WebSocketMessageType.Text || !result.EndOfMessage) continue;
        try
        {
            var input = JsonSerializer.Deserialize<PlayerInput>(buffer.AsSpan(0, result.Count));
            if (input is not null)
            {
                room.SetInput(playerId, new Vector2(input.X, input.Y));
                if (input.Dash) room.RequestDash(playerId);
                if (!string.IsNullOrWhiteSpace(input.Ability)) room.RequestAbility(playerId, input.Ability);
            }
        }
        catch (JsonException) { }
    }
}

public sealed record PlayerInput(
    [property: JsonPropertyName("x")] float X,
    [property: JsonPropertyName("y")] float Y,
    [property: JsonPropertyName("dash")] bool Dash = false,
    [property: JsonPropertyName("ability")] string? Ability = null);

public sealed class ArenaConnection(Guid playerId, WebSocket socket)
{
    public Guid PlayerId { get; } = playerId;
    public WebSocket Socket { get; } = socket;
    public SemaphoreSlim SendLock { get; } = new(1, 1);
    public bool ResultSent { get; set; }
    public DateTimeOffset ConnectedAt { get; } = DateTimeOffset.UtcNow;
}

public sealed class ArenaRoom
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly object _gate = new();
    private readonly ArenaSimulation _simulation = new();
    private readonly ConcurrentDictionary<Guid, ArenaConnection> _connections = new();
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _disconnectDeadlines = new();
    private readonly SwarmTokenService _tokens;
    public ArenaRoom(SwarmTokenService tokens) => _tokens = tokens;
    public int PlayerCount => _connections.Count;

    public ArenaConnection Connect(Guid playerId, string nickname, string skinId, WebSocket socket)
    {
        lock (_gate) _simulation.AddPlayer(playerId, nickname, skinId);
        _disconnectDeadlines.TryRemove(playerId, out _);
        var connection = new ArenaConnection(playerId, socket);
        _connections[playerId] = connection;
        return connection;
    }

    public void Disconnect(ArenaConnection connection)
    {
        if (_connections.TryGetValue(connection.PlayerId, out var current) && ReferenceEquals(current, connection))
        {
            _connections.TryRemove(connection.PlayerId, out _);
            _disconnectDeadlines[connection.PlayerId] = DateTimeOffset.UtcNow.AddSeconds(15);
        }
    }

    public void SetInput(Guid playerId, Vector2 input) { lock (_gate) _simulation.SetInput(playerId, input); }
    public void RequestDash(Guid playerId) { lock (_gate) _simulation.RequestDash(playerId); }
    public void RequestAbility(Guid playerId, string ability) { lock (_gate) _simulation.RequestAbility(playerId, ability); }

    public async Task TickAndBroadcast(TimeSpan elapsed, CancellationToken cancellationToken)
    {
        foreach (var expired in _disconnectDeadlines.Where(item => item.Value <= DateTimeOffset.UtcNow).ToArray())
        {
            if (_disconnectDeadlines.TryRemove(expired.Key, out _))
            {
                lock (_gate) _simulation.RemovePlayer(expired.Key);
            }
        }
        ArenaSnapshot snapshot;
        lock (_gate) snapshot = _simulation.Step(elapsed);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "snapshot",
            arenaWidth = ArenaSimulation.ArenaWidth,
            arenaHeight = ArenaSimulation.ArenaHeight,
            snapshot.Tick,
            snapshot.Players,
            snapshot.Energy,
            snapshot.Zones,
            snapshot.Event
        }, JsonOptions);
        foreach (var connection in _connections.Values)
        {
            await TrySend(connection, payload, cancellationToken, waitForLock: false);

            var player = snapshot.Players.FirstOrDefault(candidate => candidate.Id == connection.PlayerId);
            if (player is not null && !player.Alive && !connection.ResultSent)
            {
                var coins = 10 + (player.Score / 5) + (player.Kills * 25);
                var rank = snapshot.Players.Count(candidate => candidate.Alive && candidate.Score > player.Score) + 1;
                var durationSeconds = Math.Max(1, (int)(DateTimeOffset.UtcNow - connection.ConnectedAt).TotalSeconds);
                var nonce = Guid.NewGuid().ToString("N");
                var resultToken = _tokens.Issue(player.Id, player.Nickname, $"result|{player.Score}|{player.Kills}|{coins}|{rank}|{durationSeconds}|{nonce}", TimeSpan.FromMinutes(5));
                var resultPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "gameOver", score = player.Score, kills = player.Kills, coins, rank, durationSeconds, resultToken }, JsonOptions);
                connection.ResultSent = await TrySend(connection, resultPayload, cancellationToken, waitForLock: true);
            }
        }
    }

    private static async Task<bool> TrySend(ArenaConnection connection, byte[] payload, CancellationToken cancellationToken, bool waitForLock)
    {
        if (connection.Socket.State != WebSocketState.Open) return false;
        var acquired = waitForLock
            ? await connection.SendLock.WaitAsync(TimeSpan.FromMilliseconds(100), cancellationToken)
            : await connection.SendLock.WaitAsync(0, cancellationToken);
        if (!acquired) return false;
        try
        {
            if (connection.Socket.State != WebSocketState.Open) return false;
            await connection.Socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
            return true;
        }
        catch (Exception exception) when (exception is WebSocketException or InvalidOperationException or ObjectDisposedException)
        {
            return false;
        }
        finally
        {
            connection.SendLock.Release();
        }
    }
}

public sealed class ArenaLoopService(ArenaRoom room, ILogger<ArenaLoopService> logger) : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(50);
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TickInterval);
        logger.LogInformation("Arena loop started at {TickRate} ticks per second", 20);
        while (await timer.WaitForNextTickAsync(stoppingToken)) await room.TickAndBroadcast(TickInterval, stoppingToken);
    }
}
