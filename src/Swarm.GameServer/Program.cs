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
builder.Services.AddSingleton<ArenaRoomManager>();
builder.Services.AddHostedService<ArenaLoopService>();

var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", (ArenaRoomManager rooms) => Results.Ok(new { status = "ready", players = rooms.PlayerCount, arenas = rooms.RoomCount }));
app.Map("/ws/arena", async (HttpContext context, SwarmTokenService tokens, ArenaRoomManager rooms) =>
{
    if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = StatusCodes.Status400BadRequest; return; }
    if (!tokens.TryValidatePurposePrefix(context.Request.Query["ticket"].ToString(), "match|", out var payload))
    { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return; }

    var parts = payload.Purpose.Split('|');
    var skinId = parts.ElementAtOrDefault(1) ?? "starter";
    var mode = parts.ElementAtOrDefault(2) ?? "public";
    var roomCode = parts.ElementAtOrDefault(3);
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var joined = rooms.Connect(payload.PlayerId, payload.Nickname, skinId, mode, roomCode, socket);
    if (joined is null)
    {
        await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Arena full or invalid room.", context.RequestAborted);
        return;
    }
    try { await ReceiveInputs(socket, joined.Room, payload.PlayerId, context.RequestAborted); }
    finally { rooms.Disconnect(joined); }
});
app.Run();

static async Task ReceiveInputs(WebSocket socket, ArenaRoom room, Guid playerId, CancellationToken cancellationToken)
{
    var buffer = new byte[2048];
    while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
    {
        WebSocketReceiveResult result;
        try
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
        }
        catch (WebSocketException)
        {
            return;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return;
        }
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

public sealed class ArenaConnection(Guid playerId, string roomId, WebSocket socket)
{
    public Guid PlayerId { get; } = playerId;
    public string RoomId { get; } = roomId;
    public WebSocket Socket { get; } = socket;
    public SemaphoreSlim SendLock { get; } = new(1, 1);
    public bool ResultSent { get; set; }
    public bool NeedsFullState { get; set; } = true;
    public DateTimeOffset ConnectedAt { get; } = DateTimeOffset.UtcNow;
}

public sealed record ArenaJoin(ArenaRoom Room, ArenaConnection Connection);

public sealed class ArenaRoomManager
{
    private readonly object _gate = new();
    private readonly Dictionary<string, ArenaRoom> _rooms = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<Guid, string> _playerRooms = new();
    private readonly SwarmTokenService _tokens;
    private int _publicSequence;

    public ArenaRoomManager(SwarmTokenService tokens) => _tokens = tokens;
    public int RoomCount { get { lock (_gate) return _rooms.Count; } }
    public int PlayerCount { get { lock (_gate) return _rooms.Values.Sum(room => room.PlayerCount); } }

    public ArenaJoin? Connect(Guid playerId, string nickname, string skinId, string mode, string? requestedCode, WebSocket socket)
    {
        lock (_gate)
        {
            var isPrivate = string.Equals(mode, "private", StringComparison.OrdinalIgnoreCase);
            var normalizedCode = NormalizeRoomCode(requestedCode);
            if (isPrivate && normalizedCode is null) return null;

            ArenaRoom room;
            if (_playerRooms.TryGetValue(playerId, out var previousRoomId)
                && _rooms.TryGetValue(previousRoomId, out var previousRoom)
                && previousRoom.CanAccept(playerId)
                && (isPrivate
                    ? previousRoom.IsPrivate && string.Equals(previousRoom.Code, normalizedCode, StringComparison.OrdinalIgnoreCase)
                    : !previousRoom.IsPrivate))
            {
                room = previousRoom;
            }
            else if (isPrivate)
            {
                var roomId = $"private:{normalizedCode}";
                if (!_rooms.TryGetValue(roomId, out room!) || room.IsFinished)
                {
                    room = new ArenaRoom(roomId, normalizedCode!, true, _tokens);
                    _rooms[roomId] = room;
                }
            }
            else
            {
                room = _rooms.Values
                    .Where(candidate => !candidate.IsPrivate && candidate.CanAccept(playerId))
                    .OrderByDescending(candidate => candidate.PlayerCount)
                    .FirstOrDefault()!;
                if (room is null)
                {
                    var roomId = $"public:{++_publicSequence:D4}";
                    room = new ArenaRoom(roomId, null, false, _tokens);
                    _rooms[roomId] = room;
                }
            }

            if (!room.TryConnect(playerId, nickname, skinId, socket, out var connection)) return null;
            _playerRooms[playerId] = room.Id;
            return new ArenaJoin(room, connection!);
        }
    }

    public void Disconnect(ArenaJoin joined) => joined.Room.Disconnect(joined.Connection);

    public async Task TickAndBroadcast(TimeSpan elapsed, CancellationToken cancellationToken)
    {
        ArenaRoom[] rooms;
        lock (_gate) rooms = _rooms.Values.ToArray();
        await Task.WhenAll(rooms.Select(room => room.TickAndBroadcast(elapsed, cancellationToken)));

        lock (_gate)
        {
            foreach (var room in rooms.Where(candidate => candidate.CanRetire).ToArray())
            {
                if (!_rooms.Remove(room.Id)) continue;
                foreach (var player in _playerRooms.Where(pair => pair.Value == room.Id).Select(pair => pair.Key).ToArray())
                    _playerRooms.Remove(player);
            }
        }
    }

    private static string? NormalizeRoomCode(string? value)
    {
        var code = value?.Trim().ToUpperInvariant();
        return code is { Length: 7 } && code.StartsWith("SW-") && code[3..].All(char.IsLetterOrDigit) ? code : null;
    }
}

public sealed class ArenaRoom
{
    public const int MatchDurationSeconds = 5 * 60;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    private readonly object _gate = new();
    private readonly ArenaSimulation _simulation = new();
    private readonly ConcurrentDictionary<Guid, ArenaConnection> _connections = new();
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _disconnectDeadlines = new();
    private readonly HashSet<Guid> _lastEnergyIds = new();
    private readonly SwarmTokenService _tokens;
    private readonly DateTimeOffset _startedAt = DateTimeOffset.UtcNow;
    private DateTimeOffset _lastActivity = DateTimeOffset.UtcNow;
    public ArenaRoom(string id, string? code, bool isPrivate, SwarmTokenService tokens)
    { Id = id; Code = code; IsPrivate = isPrivate; _tokens = tokens; }
    public string Id { get; }
    public string? Code { get; }
    public bool IsPrivate { get; }
    public int PlayerCount => _connections.Count;
    public bool IsFinished => DateTimeOffset.UtcNow >= _startedAt.AddSeconds(MatchDurationSeconds);
    public int RemainingSeconds => Math.Max(0, (int)Math.Ceiling((_startedAt.AddSeconds(MatchDurationSeconds) - DateTimeOffset.UtcNow).TotalSeconds));
    public bool CanRetire => PlayerCount == 0 && DateTimeOffset.UtcNow - _lastActivity > TimeSpan.FromMinutes(2);
    public bool CanAccept(Guid playerId)
    {
        lock (_gate) return !IsFinished && (_simulation.ContainsPlayer(playerId) || _simulation.HasCapacity);
    }

    public bool TryConnect(Guid playerId, string nickname, string skinId, WebSocket socket, out ArenaConnection? connection)
    {
        connection = null;
        lock (_gate)
        {
            if (IsFinished) return false;
            if (!_simulation.ContainsPlayer(playerId) && !_simulation.HasCapacity) return false;
            _simulation.AddPlayer(playerId, nickname, skinId);
        }
        _disconnectDeadlines.TryRemove(playerId, out _);
        connection = new ArenaConnection(playerId, Id, socket);
        _connections[playerId] = connection;
        _lastActivity = DateTimeOffset.UtcNow;
        return true;
    }

    public void Disconnect(ArenaConnection connection)
    {
        if (_connections.TryGetValue(connection.PlayerId, out var current) && ReferenceEquals(current, connection))
        {
            _connections.TryRemove(connection.PlayerId, out _);
            _disconnectDeadlines[connection.PlayerId] = DateTimeOffset.UtcNow.AddSeconds(15);
            _lastActivity = DateTimeOffset.UtcNow;
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
        var matchFinished = IsFinished;
        lock (_gate)
        {
            if (!matchFinished)
            {
                _simulation.Advance(elapsed);
                matchFinished = IsFinished;
                if (!matchFinished && _simulation.Tick % 4 != 0) return;
            }
            snapshot = _simulation.Snapshot();
        }
        // Keep the authoritative simulation at 20 Hz but broadcast at 5 Hz.
        // The client predicts its own movement and interpolates remote players at 60 FPS.
        var currentEnergyIds = snapshot.Energy.Select(orb => orb.Id).ToHashSet();
        var energyAdded = snapshot.Energy.Where(orb => !_lastEnergyIds.Contains(orb.Id)).ToArray();
        var energyRemoved = _lastEnergyIds.Where(id => !currentEnergyIds.Contains(id)).ToArray();
        _lastEnergyIds.Clear();
        _lastEnergyIds.UnionWith(currentEnergyIds);
        object CreateMessage(bool fullState) => new
        {
            type = "snapshot",
            roomId = Id,
            roomCode = Code,
            isPrivate = IsPrivate,
            capacity = ArenaSimulation.MaxPlayers,
            realPlayers = snapshot.Players.Count(player => !player.IsBot),
            bots = snapshot.Players.Count(player => player.IsBot),
            matchDurationSeconds = MatchDurationSeconds,
            remainingSeconds = RemainingSeconds,
            matchFinished,
            arenaWidth = ArenaSimulation.ArenaWidth,
            arenaHeight = ArenaSimulation.ArenaHeight,
            serverTimeMs = snapshot.Tick * 50,
            snapshot.Tick,
            players = snapshot.Players.Select(CompactPlayer).ToArray(),
            energy = fullState ? snapshot.Energy.Select(CompactEnergy).ToArray() : null,
            energyAdded = !fullState && energyAdded.Length > 0 ? energyAdded.Select(CompactEnergy).ToArray() : null,
            energyRemoved = !fullState && energyRemoved.Length > 0 ? energyRemoved : null,
            zones = fullState ? snapshot.Zones : null,
            snapshot.Event
        };

        var deltaPayload = JsonSerializer.SerializeToUtf8Bytes(CreateMessage(false), JsonOptions);
        var requiresFullPayload = _connections.Values.Any(connection => connection.NeedsFullState);
        var fullPayload = requiresFullPayload
            ? JsonSerializer.SerializeToUtf8Bytes(CreateMessage(true), JsonOptions)
            : deltaPayload;
        var sendTasks = _connections.Values.Select(async connection =>
        {
            var needsFullState = connection.NeedsFullState;
            var sent = await TrySend(connection, needsFullState ? fullPayload : deltaPayload, cancellationToken, waitForLock: false);
            if (sent) connection.NeedsFullState = false;

            var player = snapshot.Players.FirstOrDefault(candidate => candidate.Id == connection.PlayerId);
            if (player is not null && (!player.Alive || matchFinished) && !connection.ResultSent)
            {
                var coins = 10 + (player.Score / 5) + (player.Kills * 25);
                var rank = snapshot.Players.Count(candidate => candidate.Alive && candidate.Score > player.Score) + 1;
                var durationSeconds = Math.Max(1, (int)(DateTimeOffset.UtcNow - connection.ConnectedAt).TotalSeconds);
                var nonce = Guid.NewGuid().ToString("N");
                var resultToken = _tokens.Issue(player.Id, player.Nickname, $"result|{player.Score}|{player.Kills}|{coins}|{rank}|{durationSeconds}|{nonce}", TimeSpan.FromMinutes(5));
                var reason = matchFinished ? "timeout" : "eliminated";
                var resultPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "gameOver", reason, score = player.Score, kills = player.Kills, coins, rank, durationSeconds, resultToken }, JsonOptions);
                connection.ResultSent = await TrySend(connection, resultPayload, cancellationToken, waitForLock: true);
            }
        });
        await Task.WhenAll(sendTasks);
    }

    private static object CompactPlayer(ArenaPlayer player) => new object[]
    {
        player.Id, player.Nickname, player.SkinId,
        MathF.Round(player.Position.X, 1), MathF.Round(player.Position.Y, 1),
        player.Score, player.Kills, MathF.Round(player.Radius, 1),
        player.Alive ? 1 : 0, player.IsBot ? 1 : 0,
        player.ShieldActive ? 1 : 0, player.MagnetActive ? 1 : 0
    };

    private static object CompactEnergy(EnergyOrb orb) => new object[]
    {
        orb.Id, MathF.Round(orb.Position.X, 1), MathF.Round(orb.Position.Y, 1), orb.Value, orb.Kind
    };

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

public sealed class ArenaLoopService(ArenaRoomManager rooms, ILogger<ArenaLoopService> logger) : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromMilliseconds(50);
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TickInterval);
        logger.LogInformation("Arena loop started at {TickRate} ticks per second", 20);
        while (await timer.WaitForNextTickAsync(stoppingToken)) await rooms.TickAndBroadcast(TickInterval, stoppingToken);
    }
}
