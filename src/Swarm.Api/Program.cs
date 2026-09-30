using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Net.Sockets;
using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using Swarm.Application;
using Swarm.Infrastructure;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "web")
});

var connectionString = builder.Configuration.GetConnectionString("Swarm")
    ?? throw new InvalidOperationException("ConnectionStrings:Swarm is required.");
var tokenSecret = Environment.GetEnvironmentVariable("SWARM_TOKEN_SECRET")
    ?? builder.Configuration["Swarm:TokenSecret"]
    ?? throw new InvalidOperationException("Swarm token secret is required.");

var databaseProvider = Environment.GetEnvironmentVariable("SWARM_DB_PROVIDER")
    ?? builder.Configuration["Swarm:DatabaseProvider"]
    ?? "Postgres";
var adminKey = Environment.GetEnvironmentVariable("SWARM_ADMIN_KEY")
    ?? builder.Configuration["Swarm:AdminKey"]
    ?? (databaseProvider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase) ? "swarm-local-admin" : string.Empty);
builder.Services.AddDbContext<SwarmDbContext>(options =>
{
    if (databaseProvider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase)) options.UseSqlite(connectionString);
    else options.UseNpgsql(connectionString);
});
builder.Services.AddSingleton(new SwarmTokenService(tokenSecret));
builder.Services.AddSingleton<FriendRoomRegistry>();
builder.Services.AddHttpClient();
builder.Services.AddCors(options => options.AddPolicy("mobile", policy => policy
    .WithOrigins("capacitor://localhost", "ionic://localhost")
    .AllowAnyHeader()
    .AllowAnyMethod()));
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions { PermitLimit = 12, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("write", context => RateLimitPartition.GetSlidingWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new SlidingWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
    options.AddPolicy("matchmaking", context => RateLimitPartition.GetSlidingWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new SlidingWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
});

var app = builder.Build();
var autoCreateDatabase = databaseProvider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase)
    || Environment.GetEnvironmentVariable("SWARM_AUTO_CREATE_DATABASE")?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SwarmDbContext>();
    if (autoCreateDatabase) await db.Database.EnsureCreatedAsync();
    await EnsureProductSchemaAsync(db, databaseProvider);
    await SeedProductDataAsync(db);
}
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseCors("mobile");
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
    await next();
});
app.UseRateLimiter();
app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (SwarmDbContext db, CancellationToken cancellationToken) =>
{
    var databaseReady = await db.Database.CanConnectAsync(cancellationToken);
    var redisHost = Environment.GetEnvironmentVariable("SWARM_REDIS_HOST");
    var redisReady = string.IsNullOrWhiteSpace(redisHost) || await CheckRedisAsync(redisHost, cancellationToken);
    return databaseReady && redisReady
        ? Results.Ok(new { status = "ready", database = "connected", redis = string.IsNullOrWhiteSpace(redisHost) ? "not-configured" : "connected" })
        : Results.Json(new { status = "unavailable", database = databaseReady, redis = redisReady }, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.MapPost("/api/v1/auth/guest", async (GuestLoginRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    var nickname = NormalizeNickname(request.Nickname);
    if (string.IsNullOrWhiteSpace(request.DeviceId) || request.DeviceId.Length > 256)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["deviceId"] = ["Geçerli bir cihaz kimliği gereklidir."] });

    var deviceHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.DeviceId)));
    var player = await db.Players.SingleOrDefaultAsync(x => x.DeviceIdHash == deviceHash, cancellationToken);
    if (player is null)
    {
        player = new PlayerRecord
        {
            Id = Guid.NewGuid(), DeviceIdHash = deviceHash, Nickname = nickname, Coins = 250, Gems = 0,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow
        };
        db.Players.Add(player);
        db.CurrencyTransactions.Add(new CurrencyTransactionRecord
        {
            Id = Guid.NewGuid(), PlayerId = player.Id, Currency = "Coins", Amount = 250, Reason = "WELCOME_REWARD",
            IdempotencyKey = $"welcome:{player.Id}", CreatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
    }
    else if (!string.Equals(player.Nickname, nickname, StringComparison.Ordinal))
    {
        player.Nickname = nickname;
        player.UpdatedAt = DateTimeOffset.UtcNow;
    }

    if (!await db.PlayerCosmetics.AnyAsync(x => x.PlayerId == player.Id && x.ItemId == "starter", cancellationToken))
    {
        db.PlayerCosmetics.Add(new PlayerCosmeticRecord
        {
            Id = Guid.NewGuid(), PlayerId = player.Id, ItemId = "starter", AcquiredAt = DateTimeOffset.UtcNow, IsEquipped = true
        });
    }
    await EnsurePlayerProgressAsync(db, player.Id, cancellationToken);
    await db.SaveChangesAsync(cancellationToken);

    var accessToken = tokens.Issue(player.Id, player.Nickname, "access", TimeSpan.FromHours(12));
    var equippedSkin = await GetEquippedSkinAsync(db, player.Id, cancellationToken);
    return Results.Ok(new GuestLoginResponse(accessToken, new PlayerResponse(player.Id, player.Nickname, player.Coins, player.Gems, equippedSkin)));
}).RequireRateLimiting("auth");

app.MapGet("/api/v1/profile", async (HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var payload)) return Results.Unauthorized();
    var player = await db.Players.FindAsync([payload.PlayerId], cancellationToken);
    if (player is null) return Results.NotFound();
    var equippedSkin = await GetEquippedSkinAsync(db, player.Id, cancellationToken);
    return Results.Ok(new PlayerResponse(player.Id, player.Nickname, player.Coins, player.Gems, equippedSkin));
});

app.MapDelete("/api/v1/profile", async (HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var player = await db.Players.FindAsync([access.PlayerId], cancellationToken);
    if (player is null) return Results.NoContent();

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    await db.PaymentPurchases.Where(x => x.PlayerId == access.PlayerId).ExecuteDeleteAsync(cancellationToken);
    await db.CurrencyTransactions.Where(x => x.PlayerId == access.PlayerId).ExecuteDeleteAsync(cancellationToken);
    await db.PlayerCosmetics.Where(x => x.PlayerId == access.PlayerId).ExecuteDeleteAsync(cancellationToken);
    await db.Matches.Where(x => x.PlayerId == access.PlayerId).ExecuteDeleteAsync(cancellationToken);
    await db.AnalyticsEvents.Where(x => x.PlayerId == access.PlayerId).ExecuteDeleteAsync(cancellationToken);
    await db.PlayerReports.Where(x => x.ReporterPlayerId == access.PlayerId || x.ReportedPlayerId == access.PlayerId.ToString()).ExecuteDeleteAsync(cancellationToken);
    db.Players.Remove(player);
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.NoContent();
}).RequireRateLimiting("write");

app.MapGet("/api/v1/store/catalog", () => Results.Ok(CosmeticCatalog.All));
app.MapGet("/api/v1/store/offers", () => Results.Ok(PaymentCatalog.All.Select(offer => new
{
    offer.Id, offer.Title, offer.Gems, offer.BonusLabel, offer.WebPriceLabel,
    appleProductId = offer.AppleProductId, googleProductId = offer.GoogleProductId,
    webAvailable = !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(offer.StripePriceEnvironmentKey))
})));

app.MapPost("/api/v1/store/web-checkout", async (WebCheckoutRequest body, HttpRequest request, IHttpClientFactory clients, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var offer = PaymentCatalog.Find(body.OfferId);
    if (offer is null) return ApiError("INVALID_OFFER", "Geçersiz kristal paketi.");
    var stripeSecret = Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY");
    var priceId = Environment.GetEnvironmentVariable(offer.StripePriceEnvironmentKey);
    if (string.IsNullOrWhiteSpace(stripeSecret) || string.IsNullOrWhiteSpace(priceId))
        return ApiError("PAYMENTS_NOT_CONFIGURED", "Web ödemeleri henüz etkin değil.", StatusCodes.Status503ServiceUnavailable);

    var origin = $"{request.Scheme}://{request.Host}";
    using var stripeRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.stripe.com/v1/checkout/sessions");
    stripeRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{stripeSecret}:")));
    stripeRequest.Content = new FormUrlEncodedContent(new Dictionary<string, string>
    {
        ["mode"] = "payment",
        ["line_items[0][price]"] = priceId,
        ["line_items[0][quantity]"] = "1",
        ["client_reference_id"] = access.PlayerId.ToString(),
        ["metadata[offer_id]"] = offer.Id,
        ["success_url"] = $"{origin}/?payment=success",
        ["cancel_url"] = $"{origin}/?payment=cancelled"
    });
    var stripeResponse = await clients.CreateClient().SendAsync(stripeRequest, cancellationToken);
    var stripePayload = await stripeResponse.Content.ReadAsStringAsync(cancellationToken);
    if (!stripeResponse.IsSuccessStatusCode) return ApiError("CHECKOUT_FAILED", "Ödeme sayfası oluşturulamadı.", StatusCodes.Status502BadGateway);
    using var document = JsonDocument.Parse(stripePayload);
    return Results.Ok(new { url = document.RootElement.GetProperty("url").GetString() });
}).RequireRateLimiting("write");

app.MapGet("/api/v1/inventory", async (HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var payload)) return Results.Unauthorized();
    if (!await db.PlayerCosmetics.AnyAsync(x => x.PlayerId == payload.PlayerId && x.ItemId == "starter", cancellationToken))
    {
        db.PlayerCosmetics.Add(new PlayerCosmeticRecord
        {
            Id = Guid.NewGuid(), PlayerId = payload.PlayerId, ItemId = "starter", AcquiredAt = DateTimeOffset.UtcNow, IsEquipped = true
        });
        await db.SaveChangesAsync(cancellationToken);
    }
    var records = await db.PlayerCosmetics.Where(x => x.PlayerId == payload.PlayerId).ToListAsync(cancellationToken);
    var owned = records.OrderBy(x => x.AcquiredAt).Select(x => new InventoryItemResponse(x.ItemId, x.IsEquipped, x.AcquiredAt)).ToList();
    return Results.Ok(new { items = owned });
});

app.MapPost("/api/v1/store/purchase", async (CosmeticActionRequest body, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var payload)) return Results.Unauthorized();
    var item = CosmeticCatalog.Find(body.ItemId);
    if (item is null || item.Id == "starter") return Results.BadRequest(new { error = "INVALID_ITEM" });
    if (await db.PlayerCosmetics.AnyAsync(x => x.PlayerId == payload.PlayerId && x.ItemId == item.Id, cancellationToken))
        return Results.Conflict(new { error = "ALREADY_OWNED" });

    var player = await db.Players.FindAsync([payload.PlayerId], cancellationToken);
    if (player is null) return Results.NotFound();
    if (item.Currency == "Coins" && player.Coins < item.Price || item.Currency == "Gems" && player.Gems < item.Price)
        return Results.BadRequest(new { error = "INSUFFICIENT_FUNDS" });

    if (item.Currency == "Coins") player.Coins -= item.Price;
    else player.Gems -= item.Price;
    player.UpdatedAt = DateTimeOffset.UtcNow;
    db.PlayerCosmetics.Add(new PlayerCosmeticRecord
    {
        Id = Guid.NewGuid(), PlayerId = player.Id, ItemId = item.Id, AcquiredAt = DateTimeOffset.UtcNow, IsEquipped = false
    });
    db.CurrencyTransactions.Add(new CurrencyTransactionRecord
    {
        Id = Guid.NewGuid(), PlayerId = player.Id, Currency = item.Currency, Amount = -item.Price,
        Reason = "COSMETIC_PURCHASE", IdempotencyKey = $"purchase:{player.Id}:{item.Id}", CreatedAt = DateTimeOffset.UtcNow
    });
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { itemId = item.Id, player.Coins, player.Gems });
}).RequireRateLimiting("write");

app.MapPost("/api/v1/inventory/equip", async (CosmeticActionRequest body, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var payload)) return Results.Unauthorized();
    var target = await db.PlayerCosmetics.SingleOrDefaultAsync(x => x.PlayerId == payload.PlayerId && x.ItemId == body.ItemId, cancellationToken);
    if (target is null) return Results.BadRequest(new { error = "NOT_OWNED" });
    var equipped = await db.PlayerCosmetics.Where(x => x.PlayerId == payload.PlayerId && x.IsEquipped).ToListAsync(cancellationToken);
    foreach (var entry in equipped) entry.IsEquipped = false;
    target.IsEquipped = true;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { equippedSkin = target.ItemId });
}).RequireRateLimiting("write");

app.MapPost("/api/v1/matchmaking/rooms", (HttpRequest request, SwarmTokenService tokens, FriendRoomRegistry rooms) =>
{
    if (!TryGetAccessToken(request, tokens, out _)) return Results.Unauthorized();
    return Results.Ok(new { roomCode = rooms.Create(), capacity = ArenaSimulation.MaxPlayers });
}).RequireRateLimiting("matchmaking");

app.MapPost("/api/v1/matchmaking/queue", async (string? mode, string? roomCode, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, FriendRoomRegistry rooms, IConfiguration configuration, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var payload)) return Results.Unauthorized();
    var matchmakingMode = string.Equals(mode, "private", StringComparison.OrdinalIgnoreCase) ? "private" : "public";
    var normalizedRoomCode = matchmakingMode == "private" ? NormalizeRoomCode(roomCode) : null;
    if (matchmakingMode == "private" && normalizedRoomCode is null)
        return ApiError("INVALID_ROOM_CODE", "Oda kodu SW-XXXX biçiminde olmalıdır.");
    if (matchmakingMode == "private" && !rooms.Exists(normalizedRoomCode!))
        return ApiError("ROOM_NOT_FOUND", "Bu arkadaş odası bulunamadı veya süresi doldu.", StatusCodes.Status404NotFound);
    var skinId = await GetEquippedSkinAsync(db, payload.PlayerId, cancellationToken);
    var ticket = tokens.Issue(payload.PlayerId, payload.Nickname, $"match|{skinId}|{matchmakingMode}|{normalizedRoomCode ?? string.Empty}", TimeSpan.FromMinutes(2));
    var gameUrl = Environment.GetEnvironmentVariable("SWARM_GAME_WS_URL") ?? configuration["Swarm:GameWebSocketUrl"] ?? "ws://localhost:5090/ws/arena";
    return Results.Ok(new { ticket, websocketUrl = gameUrl, mode = matchmakingMode, roomCode = normalizedRoomCode, capacity = ArenaSimulation.MaxPlayers, expiresInSeconds = 120 });
}).RequireRateLimiting("matchmaking");

app.MapPost("/api/v1/rewards/match", async (MatchRewardRequest body, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    if (!tokens.TryValidatePurposePrefix(body.ResultToken, "result|", out var result) || result.PlayerId != access.PlayerId)
        return Results.BadRequest(new { error = "INVALID_MATCH_RESULT" });
    var parts = result.Purpose.Split('|');
    if (parts.Length != 7 || !int.TryParse(parts[1], out var score) || !int.TryParse(parts[2], out var kills) || !long.TryParse(parts[3], out var coins) || !int.TryParse(parts[4], out var rank) || !int.TryParse(parts[5], out var durationSeconds))
        return Results.BadRequest(new { error = "INVALID_MATCH_RESULT" });

    var resultHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body.ResultToken)));
    var idempotencyKey = $"match:{resultHash}";
    var existing = await db.CurrencyTransactions.SingleOrDefaultAsync(x => x.IdempotencyKey == idempotencyKey, cancellationToken);
    var player = await db.Players.FindAsync([access.PlayerId], cancellationToken);
    if (player is null) return Results.NotFound();
    var progress = await EnsurePlayerProgressAsync(db, player.Id, cancellationToken);
    var xp = 25L + (score / 4L) + (kills * 20L);
    if (existing is null)
    {
        player.Coins += coins;
        player.UpdatedAt = DateTimeOffset.UtcNow;
        progress.TotalMatches++;
        progress.TotalKills += kills;
        if (rank == 1) progress.Wins++;
        progress.BestScore = Math.Max(progress.BestScore, score);
        progress.HighestRank = progress.HighestRank == 0 ? rank : Math.Min(progress.HighestRank, rank);
        progress.Experience += xp;
        progress.SeasonXp += xp;
        progress.Level = LevelFromExperience(progress.Experience);
        progress.UpdatedAt = DateTimeOffset.UtcNow;
        db.CurrencyTransactions.Add(new CurrencyTransactionRecord
        {
            Id = Guid.NewGuid(), PlayerId = player.Id, Currency = "Coins", Amount = coins,
            Reason = "MATCH_REWARD", IdempotencyKey = idempotencyKey, CreatedAt = DateTimeOffset.UtcNow
        });
        db.Matches.Add(new MatchRecord
        {
            Id = Guid.NewGuid(), PlayerId = player.Id, Score = score, Kills = kills, Rank = rank, DurationSeconds = durationSeconds,
            CoinsEarned = coins, XpEarned = xp, IsSuspicious = score > 100_000 || kills > 100,
            ResultHash = resultHash, PlayedAt = DateTimeOffset.UtcNow
        });
        db.AnalyticsEvents.Add(new AnalyticsEventRecord
        {
            Id = Guid.NewGuid(), PlayerId = player.Id, Name = "match_end",
            PropertiesJson = JsonSerializer.Serialize(new { score, kills, coins, xp }), OccurredAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
    }
    return Results.Ok(new { score, kills, rank, durationSeconds, coins, xp, level = progress.Level, balance = player.Coins, alreadyClaimed = existing is not null });
}).RequireRateLimiting("write");

app.MapGet("/api/v1/meta/home", async (HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var player = await db.Players.FindAsync([access.PlayerId], cancellationToken);
    if (player is null) return Results.NotFound();
    var progress = await EnsurePlayerProgressAsync(db, player.Id, cancellationToken);
    await db.SaveChangesAsync(cancellationToken);
    var today = DateTimeOffset.UtcNow.Date;
    var recentMatches = db.Database.IsSqlite()
        ? (await db.Matches.Where(x => x.PlayerId == player.Id).ToListAsync(cancellationToken)).Where(x => x.PlayedAt >= today).ToList()
        : await db.Matches.Where(x => x.PlayerId == player.Id && x.PlayedAt >= today).ToListAsync(cancellationToken);
    var missions = MissionCatalog.Build(progress, recentMatches);
    var dailyAvailable = progress.LastDailyClaimAt is null || progress.LastDailyClaimAt.Value.UtcDateTime.Date < today;
    return Results.Ok(new
    {
        profile = new { player.Id, player.Nickname, player.Coins, player.Gems, progress.Level, progress.Experience, progress.TotalMatches, progress.Wins, progress.TotalKills, progress.BestScore, progress.HighestRank, equippedSkin = await GetEquippedSkinAsync(db, player.Id, cancellationToken) },
        dailyReward = new { available = dailyAvailable, streak = progress.DailyStreak, nextDay = (progress.DailyStreak % 7) + 1 },
        missions,
        season = SeasonCatalog.Build(progress.SeasonXp),
        announcement = new { title = "SEASON 01 · COSMIC RISE", message = "Görevleri tamamla, sezon yolunda yüksel ve kozmetik ödülleri aç." }
    });
});

app.MapPost("/api/v1/rewards/daily", async (HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var player = await db.Players.FindAsync([access.PlayerId], cancellationToken);
    if (player is null) return Results.NotFound();
    var progress = await EnsurePlayerProgressAsync(db, player.Id, cancellationToken);
    var now = DateTimeOffset.UtcNow;
    if (progress.LastDailyClaimAt?.UtcDateTime.Date == now.UtcDateTime.Date) return ApiError("DAILY_ALREADY_CLAIMED", "Günlük ödül bugün zaten alındı.", StatusCodes.Status409Conflict);
    progress.DailyStreak = progress.LastDailyClaimAt?.UtcDateTime.Date == now.UtcDateTime.Date.AddDays(-1) ? progress.DailyStreak + 1 : 1;
    var day = ((progress.DailyStreak - 1) % 7) + 1;
    var coins = day switch { 1 => 100, 2 => 125, 3 => 150, 4 => 175, 6 => 250, 7 => 500, _ => 0 };
    var gems = day == 5 ? 10 : 0;
    player.Coins += coins; player.Gems += gems; player.UpdatedAt = now;
    progress.LastDailyClaimAt = now; progress.UpdatedAt = now;
    db.CurrencyTransactions.Add(new CurrencyTransactionRecord { Id = Guid.NewGuid(), PlayerId = player.Id, Currency = gems > 0 ? "Gems" : "Coins", Amount = gems > 0 ? gems : coins, Reason = "DAILY_REWARD", IdempotencyKey = $"daily:{player.Id}:{now:yyyyMMdd}", CreatedAt = now });
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { day, coins, gems, streak = progress.DailyStreak, balanceCoins = player.Coins, balanceGems = player.Gems });
}).RequireRateLimiting("write");

app.MapGet("/api/v1/leaderboards/global", async (SwarmDbContext db, CancellationToken cancellationToken) =>
{
    var rows = await (from progress in db.PlayerProgress join player in db.Players on progress.PlayerId equals player.Id orderby progress.BestScore descending select new { player.Id, player.Nickname, progress.Level, progress.BestScore, progress.TotalKills, progress.TotalMatches }).Take(100).ToListAsync(cancellationToken);
    return Results.Ok(new { updatedAt = DateTimeOffset.UtcNow, entries = rows.Select((row, index) => new { rank = index + 1, row.Id, row.Nickname, row.Level, score = row.BestScore, kills = row.TotalKills, matches = row.TotalMatches }) });
});

app.MapGet("/api/v1/matches/history", async (HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var records = await db.Matches.Where(x => x.PlayerId == access.PlayerId && !x.IsSuspicious).ToListAsync(cancellationToken);
    var matches = records.OrderByDescending(x => x.PlayedAt).Take(25).Select(x => new { x.Id, x.Score, x.Kills, x.Rank, x.CoinsEarned, x.XpEarned, x.PlayedAt }).ToList();
    return Results.Ok(new { matches });
});

app.MapPost("/api/v1/reports", async (PlayerReportRequest body, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var reasons = new[] { "cheating", "abusive_name", "harassment", "exploit", "inappropriate_behavior" };
    if (!reasons.Contains(body.Reason) || string.IsNullOrWhiteSpace(body.ReportedNickname)) return ApiError("INVALID_REPORT", "Geçerli oyuncu ve rapor sebebi gereklidir.");
    db.PlayerReports.Add(new PlayerReportRecord { Id = Guid.NewGuid(), ReporterPlayerId = access.PlayerId, ReportedPlayerId = body.ReportedPlayerId, ReportedNickname = body.ReportedNickname.Trim()[..Math.Min(24, body.ReportedNickname.Trim().Length)], Reason = body.Reason, Details = body.Details?[..Math.Min(500, body.Details.Length)], Status = "OPEN", CreatedAt = DateTimeOffset.UtcNow });
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { success = true });
}).RequireRateLimiting("write");

app.MapPost("/api/v1/analytics/events", async (AnalyticsEventRequest body, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, CancellationToken cancellationToken) =>
{
    Guid? playerId = null;
    if (TryGetAccessToken(request, tokens, out var analyticsAccess)) playerId = analyticsAccess.PlayerId;
    if (!AnalyticsCatalog.Allowed.Contains(body.Name)) return ApiError("INVALID_EVENT", "Desteklenmeyen analitik olayı.");
    var properties = JsonSerializer.Serialize(body.Properties ?? new Dictionary<string, string>());
    if (properties.Length > 2048) return ApiError("EVENT_TOO_LARGE", "Analitik olay verisi çok büyük.");
    db.AnalyticsEvents.Add(new AnalyticsEventRecord { Id = Guid.NewGuid(), PlayerId = playerId, Name = body.Name, PropertiesJson = properties, OccurredAt = DateTimeOffset.UtcNow });
    await db.SaveChangesAsync(cancellationToken);
    return Results.Accepted();
}).RequireRateLimiting("write");

app.MapGet("/api/v1/config", async (SwarmDbContext db, CancellationToken cancellationToken) =>
{
    var values = await db.RemoteConfigs.ToDictionaryAsync(x => x.Key, x => x.Value, cancellationToken);
    return Results.Ok(new { minimumSupportedVersion = "1.0.0", latestVersion = "1.0.0", maintenance = values.GetValueOrDefault("MAINTENANCE_MODE", "false") == "true", features = values });
});

app.MapPost("/api/v1/payments/stripe/webhook", async (HttpRequest request, SwarmDbContext db, CancellationToken cancellationToken) =>
{
    var webhookSecret = Environment.GetEnvironmentVariable("STRIPE_WEBHOOK_SECRET");
    if (string.IsNullOrWhiteSpace(webhookSecret)) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
    using var reader = new StreamReader(request.Body, Encoding.UTF8);
    var payload = await reader.ReadToEndAsync(cancellationToken);
    if (!VerifyStripeSignature(payload, request.Headers["Stripe-Signature"].ToString(), webhookSecret)) return Results.Unauthorized();
    using var document = JsonDocument.Parse(payload);
    var root = document.RootElement;
    if (root.GetProperty("type").GetString() != "checkout.session.completed") return Results.Ok();
    var session = root.GetProperty("data").GetProperty("object");
    if (session.GetProperty("payment_status").GetString() != "paid") return Results.Ok();

    var eventId = root.GetProperty("id").GetString() ?? string.Empty;
    var sessionId = session.GetProperty("id").GetString() ?? string.Empty;
    var playerText = session.GetProperty("client_reference_id").GetString();
    var offerId = session.GetProperty("metadata").GetProperty("offer_id").GetString();
    var offer = PaymentCatalog.Find(offerId);
    if (!Guid.TryParse(playerText, out var playerId) || offer is null || string.IsNullOrWhiteSpace(eventId) || string.IsNullOrWhiteSpace(sessionId)) return Results.BadRequest();

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    if (await db.PaymentPurchases.AnyAsync(x => x.Provider == "stripe" && x.ProviderTransactionId == sessionId, cancellationToken)) return Results.Ok();
    var player = await db.Players.FindAsync([playerId], cancellationToken);
    if (player is null) return Results.BadRequest();
    var amount = session.TryGetProperty("amount_total", out var amountNode) ? amountNode.GetInt64() : 0;
    var currency = session.TryGetProperty("currency", out var currencyNode) ? currencyNode.GetString() ?? "try" : "try";
    player.Gems += offer.Gems; player.UpdatedAt = DateTimeOffset.UtcNow;
    db.PaymentPurchases.Add(new PaymentPurchaseRecord { Id = Guid.NewGuid(), Provider = "stripe", ProviderTransactionId = sessionId, PlayerId = playerId, OfferId = offer.Id, Currency = currency, AmountMinor = amount, GemsGranted = offer.Gems, Status = "PAID", CreatedAt = DateTimeOffset.UtcNow });
    db.CurrencyTransactions.Add(new CurrencyTransactionRecord { Id = Guid.NewGuid(), PlayerId = playerId, Currency = "Gems", Amount = offer.Gems, Reason = "WEB_PURCHASE", IdempotencyKey = $"stripe:{eventId}", CreatedAt = DateTimeOffset.UtcNow });
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok();
});

app.MapPost("/api/v1/payments/apple/complete", async (ApplePurchaseRequest body, HttpRequest request, SwarmDbContext db, SwarmTokenService tokens, IHttpClientFactory clients, CancellationToken cancellationToken) =>
{
    if (!TryGetAccessToken(request, tokens, out var access)) return Results.Unauthorized();
    var offer = PaymentCatalog.Find(body.OfferId);
    if (offer is null || !string.Equals(offer.AppleProductId, body.ProductId, StringComparison.Ordinal))
        return ApiError("INVALID_OFFER", "Geçersiz App Store ürünü.");
    if (string.IsNullOrWhiteSpace(body.TransactionId) || body.TransactionId.Length > 160)
        return ApiError("INVALID_TRANSACTION", "Geçerli App Store işlem kimliği gerekli.");

    var issuerId = Environment.GetEnvironmentVariable("APPLE_ISSUER_ID");
    var keyId = Environment.GetEnvironmentVariable("APPLE_KEY_ID");
    var privateKey = Environment.GetEnvironmentVariable("APPLE_PRIVATE_KEY");
    var bundleId = Environment.GetEnvironmentVariable("APPLE_BUNDLE_ID") ?? "io.swarm.game";
    if (string.IsNullOrWhiteSpace(issuerId) || string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(privateKey))
        return ApiError("PAYMENTS_NOT_CONFIGURED", "Apple ödeme doğrulaması henüz etkin değil.", StatusCodes.Status503ServiceUnavailable);

    AppleTransactionInfo? verified;
    try
    {
        var jwt = CreateAppleServerToken(issuerId, keyId, privateKey, bundleId);
        verified = await GetAppleTransactionAsync(clients.CreateClient(), body.TransactionId, jwt, cancellationToken);
    }
    catch
    {
        return ApiError("APPLE_VERIFICATION_FAILED", "Satın alma Apple tarafından doğrulanamadı.", StatusCodes.Status502BadGateway);
    }
    if (verified is null || !string.Equals(verified.TransactionId, body.TransactionId, StringComparison.Ordinal)
        || !string.Equals(verified.ProductId, offer.AppleProductId, StringComparison.Ordinal)
        || !string.Equals(verified.BundleId, bundleId, StringComparison.Ordinal)
        || verified.Revoked)
        return ApiError("APPLE_TRANSACTION_INVALID", "App Store işlemi geçerli değil.");

    await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
    var existing = await db.PaymentPurchases.SingleOrDefaultAsync(x => x.Provider == "apple" && x.ProviderTransactionId == body.TransactionId, cancellationToken);
    if (existing is not null)
    {
        if (existing.PlayerId != access.PlayerId) return ApiError("TRANSACTION_ALREADY_USED", "Bu işlem daha önce kullanılmış.", StatusCodes.Status409Conflict);
        var existingPlayer = await db.Players.FindAsync([access.PlayerId], cancellationToken);
        return Results.Ok(new { success = true, gems = existingPlayer?.Gems ?? 0, duplicate = true });
    }

    var player = await db.Players.FindAsync([access.PlayerId], cancellationToken);
    if (player is null) return Results.NotFound();
    player.Gems += offer.Gems;
    player.UpdatedAt = DateTimeOffset.UtcNow;
    db.PaymentPurchases.Add(new PaymentPurchaseRecord { Id = Guid.NewGuid(), Provider = "apple", ProviderTransactionId = body.TransactionId, PlayerId = player.Id, OfferId = offer.Id, Currency = verified.Currency ?? "", AmountMinor = verified.Price ?? 0, GemsGranted = offer.Gems, Status = "PAID", CreatedAt = DateTimeOffset.UtcNow });
    db.CurrencyTransactions.Add(new CurrencyTransactionRecord { Id = Guid.NewGuid(), PlayerId = player.Id, Currency = "Gems", Amount = offer.Gems, Reason = "APPLE_PURCHASE", IdempotencyKey = $"apple:{body.TransactionId}", CreatedAt = DateTimeOffset.UtcNow });
    await db.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new { success = true, gems = player.Gems, granted = offer.Gems });
}).RequireRateLimiting("write");

app.MapGet("/api/v1/admin/overview", async (HttpRequest request, SwarmDbContext db, CancellationToken cancellationToken) =>
{
    if (!IsAdmin(request, adminKey)) return Results.Unauthorized();
    var since = DateTimeOffset.UtcNow.AddDays(-1);
    var matches = await db.Matches.ToListAsync(cancellationToken);
    var transactions = await db.CurrencyTransactions.ToListAsync(cancellationToken);
    return Results.Ok(new { players = await db.Players.CountAsync(cancellationToken), matches24h = matches.Count(x => x.PlayedAt >= since), purchases24h = transactions.Count(x => x.Reason == "COSMETIC_PURCHASE" && x.CreatedAt >= since), openReports = await db.PlayerReports.CountAsync(x => x.Status == "OPEN", cancellationToken), suspiciousMatches = matches.Count(x => x.IsSuspicious), economyVolume24h = transactions.Where(x => x.CreatedAt >= since).Sum(x => Math.Abs(x.Amount)) });
});

app.MapGet("/api/v1/admin/players", async (string? search, HttpRequest request, SwarmDbContext db, CancellationToken cancellationToken) =>
{
    if (!IsAdmin(request, adminKey)) return Results.Unauthorized();
    var query = db.Players.AsQueryable();
    if (!string.IsNullOrWhiteSpace(search)) query = query.Where(x => x.Nickname.Contains(search));
    var players = (await query.Take(250).ToListAsync(cancellationToken)).OrderByDescending(x => x.UpdatedAt).Take(100).ToList();
    return Results.Ok(players.Select(x => new { x.Id, x.Nickname, x.Coins, x.Gems, x.CreatedAt, x.UpdatedAt }));
});

app.MapGet("/api/v1/admin/reports", async (HttpRequest request, SwarmDbContext db, CancellationToken cancellationToken) =>
{
    if (!IsAdmin(request, adminKey)) return Results.Unauthorized();
    return Results.Ok((await db.PlayerReports.Take(250).ToListAsync(cancellationToken)).OrderByDescending(x => x.CreatedAt).Take(100));
});

app.MapPut("/api/v1/admin/config/{key}", async (string key, RemoteConfigRequest body, HttpRequest request, SwarmDbContext db, CancellationToken cancellationToken) =>
{
    if (!IsAdmin(request, adminKey)) return Results.Unauthorized();
    if (!RemoteConfigCatalog.Keys.Contains(key) || body.Value.Length > 2048) return ApiError("INVALID_CONFIG", "Geçersiz ayar.");
    var record = await db.RemoteConfigs.FindAsync([key], cancellationToken);
    var old = record?.Value;
    if (record is null) db.RemoteConfigs.Add(new RemoteConfigRecord { Key = key, Value = body.Value, UpdatedAt = DateTimeOffset.UtcNow });
    else { record.Value = body.Value; record.UpdatedAt = DateTimeOffset.UtcNow; }
    db.AdminAuditLogs.Add(new AdminAuditRecord { Id = Guid.NewGuid(), AdminId = "api-admin", Action = "CONFIG_UPDATE", Entity = key, OldValue = old, NewValue = body.Value, IpAddress = request.HttpContext.Connection.RemoteIpAddress?.ToString(), CreatedAt = DateTimeOffset.UtcNow });
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { key, body.Value });
}).RequireRateLimiting("write");

app.MapFallbackToFile("index.html");
app.Run();

static string NormalizeNickname(string? nickname)
{
    var value = string.IsNullOrWhiteSpace(nickname) ? $"Hunter{Random.Shared.Next(1000, 9999)}" : nickname.Trim();
    return value.Length <= 24 ? value : value[..24];
}

static string? NormalizeRoomCode(string? value)
{
    var code = value?.Trim().ToUpperInvariant();
    return code is { Length: 7 } && code.StartsWith("SW-") && code[3..].All(char.IsLetterOrDigit) ? code : null;
}

static async Task<bool> CheckRedisAsync(string host, CancellationToken cancellationToken)
{
    try
    {
        using var client = new TcpClient();
        await client.ConnectAsync(host, 6379, cancellationToken);
        await using var stream = client.GetStream();
        await stream.WriteAsync("*1\r\n$4\r\nPING\r\n"u8.ToArray(), cancellationToken);
        var buffer = new byte[7];
        var read = await stream.ReadAsync(buffer, cancellationToken);
        return read >= 5 && Encoding.ASCII.GetString(buffer, 0, read).StartsWith("+PONG", StringComparison.Ordinal);
    }
    catch (Exception exception) when (exception is SocketException or IOException or OperationCanceledException) { return false; }
}

static bool TryGetAccessToken(HttpRequest request, SwarmTokenService tokens, out SwarmTokenPayload payload)
{
    payload = default!;
    var header = request.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) && tokens.TryValidate(header[7..], "access", out payload);
}

static async Task<string> GetEquippedSkinAsync(SwarmDbContext db, Guid playerId, CancellationToken cancellationToken)
    => await db.PlayerCosmetics.Where(x => x.PlayerId == playerId && x.IsEquipped).Select(x => x.ItemId).FirstOrDefaultAsync(cancellationToken) ?? "starter";

static async Task EnsureProductSchemaAsync(SwarmDbContext db, string provider)
{
    var sql = provider.Equals("Sqlite", StringComparison.OrdinalIgnoreCase)
        ? """
          CREATE TABLE IF NOT EXISTS player_cosmetics (
              Id TEXT NOT NULL CONSTRAINT PK_player_cosmetics PRIMARY KEY,
              PlayerId TEXT NOT NULL,
              ItemId TEXT NOT NULL,
              AcquiredAt TEXT NOT NULL,
              IsEquipped INTEGER NOT NULL DEFAULT 0,
              CONSTRAINT FK_player_cosmetics_players_PlayerId FOREIGN KEY (PlayerId) REFERENCES players (Id) ON DELETE RESTRICT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS IX_player_cosmetics_PlayerId_ItemId ON player_cosmetics (PlayerId, ItemId);
          CREATE INDEX IF NOT EXISTS IX_player_cosmetics_PlayerId_IsEquipped ON player_cosmetics (PlayerId, IsEquipped);
          CREATE TABLE IF NOT EXISTS player_progress (PlayerId TEXT NOT NULL PRIMARY KEY, Experience INTEGER NOT NULL DEFAULT 0, Level INTEGER NOT NULL DEFAULT 1, TotalMatches INTEGER NOT NULL DEFAULT 0, Wins INTEGER NOT NULL DEFAULT 0, TotalKills INTEGER NOT NULL DEFAULT 0, BestScore INTEGER NOT NULL DEFAULT 0, HighestRank INTEGER NOT NULL DEFAULT 0, SeasonXp INTEGER NOT NULL DEFAULT 0, DailyStreak INTEGER NOT NULL DEFAULT 0, LastDailyClaimAt TEXT NULL, UpdatedAt TEXT NOT NULL, FOREIGN KEY (PlayerId) REFERENCES players (Id) ON DELETE CASCADE);
          CREATE INDEX IF NOT EXISTS IX_player_progress_SeasonXp ON player_progress (SeasonXp);
          CREATE INDEX IF NOT EXISTS IX_player_progress_BestScore ON player_progress (BestScore);
          CREATE TABLE IF NOT EXISTS matches (Id TEXT NOT NULL PRIMARY KEY, PlayerId TEXT NOT NULL, Score INTEGER NOT NULL, Kills INTEGER NOT NULL, Rank INTEGER NOT NULL, DurationSeconds INTEGER NOT NULL, CoinsEarned INTEGER NOT NULL, XpEarned INTEGER NOT NULL, IsSuspicious INTEGER NOT NULL DEFAULT 0, ResultHash TEXT NOT NULL, PlayedAt TEXT NOT NULL, FOREIGN KEY (PlayerId) REFERENCES players (Id) ON DELETE RESTRICT);
          CREATE UNIQUE INDEX IF NOT EXISTS IX_matches_ResultHash ON matches (ResultHash);
          CREATE INDEX IF NOT EXISTS IX_matches_PlayerId_PlayedAt ON matches (PlayerId, PlayedAt);
          CREATE INDEX IF NOT EXISTS IX_matches_IsSuspicious_Score ON matches (IsSuspicious, Score);
          CREATE TABLE IF NOT EXISTS analytics_events (Id TEXT NOT NULL PRIMARY KEY, PlayerId TEXT NULL, Name TEXT NOT NULL, PropertiesJson TEXT NOT NULL, OccurredAt TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS IX_analytics_events_Name_OccurredAt ON analytics_events (Name, OccurredAt);
          CREATE TABLE IF NOT EXISTS player_reports (Id TEXT NOT NULL PRIMARY KEY, ReporterPlayerId TEXT NOT NULL, ReportedPlayerId TEXT NULL, ReportedNickname TEXT NOT NULL, Reason TEXT NOT NULL, Details TEXT NULL, Status TEXT NOT NULL, CreatedAt TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS IX_player_reports_Status_CreatedAt ON player_reports (Status, CreatedAt);
          CREATE TABLE IF NOT EXISTS remote_config (Key TEXT NOT NULL PRIMARY KEY, Value TEXT NOT NULL, UpdatedAt TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS admin_audit_logs (Id TEXT NOT NULL PRIMARY KEY, AdminId TEXT NOT NULL, Action TEXT NOT NULL, Entity TEXT NOT NULL, OldValue TEXT NULL, NewValue TEXT NULL, IpAddress TEXT NULL, CreatedAt TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS IX_admin_audit_logs_CreatedAt ON admin_audit_logs (CreatedAt);
          CREATE TABLE IF NOT EXISTS payment_purchases (Id TEXT NOT NULL PRIMARY KEY, Provider TEXT NOT NULL, ProviderTransactionId TEXT NOT NULL, PlayerId TEXT NOT NULL, OfferId TEXT NOT NULL, Currency TEXT NOT NULL, AmountMinor INTEGER NOT NULL, GemsGranted INTEGER NOT NULL, Status TEXT NOT NULL, CreatedAt TEXT NOT NULL, FOREIGN KEY (PlayerId) REFERENCES players (Id) ON DELETE RESTRICT);
          CREATE UNIQUE INDEX IF NOT EXISTS IX_payment_purchases_Provider_ProviderTransactionId ON payment_purchases (Provider, ProviderTransactionId);
          CREATE INDEX IF NOT EXISTS IX_payment_purchases_PlayerId_CreatedAt ON payment_purchases (PlayerId, CreatedAt);
          """
        : """
          CREATE TABLE IF NOT EXISTS player_cosmetics (
              "Id" uuid NOT NULL CONSTRAINT "PK_player_cosmetics" PRIMARY KEY,
              "PlayerId" uuid NOT NULL,
              "ItemId" character varying(48) NOT NULL,
              "AcquiredAt" timestamp with time zone NOT NULL,
              "IsEquipped" boolean NOT NULL DEFAULT FALSE,
              CONSTRAINT "FK_player_cosmetics_players_PlayerId" FOREIGN KEY ("PlayerId") REFERENCES players ("Id") ON DELETE RESTRICT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS "IX_player_cosmetics_PlayerId_ItemId" ON player_cosmetics ("PlayerId", "ItemId");
          CREATE INDEX IF NOT EXISTS "IX_player_cosmetics_PlayerId_IsEquipped" ON player_cosmetics ("PlayerId", "IsEquipped");
          CREATE TABLE IF NOT EXISTS player_progress ("PlayerId" uuid NOT NULL PRIMARY KEY REFERENCES players ("Id") ON DELETE CASCADE, "Experience" bigint NOT NULL DEFAULT 0, "Level" integer NOT NULL DEFAULT 1, "TotalMatches" integer NOT NULL DEFAULT 0, "Wins" integer NOT NULL DEFAULT 0, "TotalKills" integer NOT NULL DEFAULT 0, "BestScore" integer NOT NULL DEFAULT 0, "HighestRank" integer NOT NULL DEFAULT 0, "SeasonXp" bigint NOT NULL DEFAULT 0, "DailyStreak" integer NOT NULL DEFAULT 0, "LastDailyClaimAt" timestamp with time zone NULL, "UpdatedAt" timestamp with time zone NOT NULL);
          CREATE INDEX IF NOT EXISTS "IX_player_progress_SeasonXp" ON player_progress ("SeasonXp");
          CREATE INDEX IF NOT EXISTS "IX_player_progress_BestScore" ON player_progress ("BestScore");
          CREATE TABLE IF NOT EXISTS matches ("Id" uuid NOT NULL PRIMARY KEY, "PlayerId" uuid NOT NULL REFERENCES players ("Id") ON DELETE RESTRICT, "Score" integer NOT NULL, "Kills" integer NOT NULL, "Rank" integer NOT NULL, "DurationSeconds" integer NOT NULL, "CoinsEarned" bigint NOT NULL, "XpEarned" bigint NOT NULL, "IsSuspicious" boolean NOT NULL DEFAULT FALSE, "ResultHash" character varying(128) NOT NULL, "PlayedAt" timestamp with time zone NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS "IX_matches_ResultHash" ON matches ("ResultHash");
          CREATE INDEX IF NOT EXISTS "IX_matches_PlayerId_PlayedAt" ON matches ("PlayerId", "PlayedAt");
          CREATE INDEX IF NOT EXISTS "IX_matches_IsSuspicious_Score" ON matches ("IsSuspicious", "Score");
          CREATE TABLE IF NOT EXISTS analytics_events ("Id" uuid NOT NULL PRIMARY KEY, "PlayerId" uuid NULL, "Name" character varying(64) NOT NULL, "PropertiesJson" character varying(2048) NOT NULL, "OccurredAt" timestamp with time zone NOT NULL);
          CREATE INDEX IF NOT EXISTS "IX_analytics_events_Name_OccurredAt" ON analytics_events ("Name", "OccurredAt");
          CREATE TABLE IF NOT EXISTS player_reports ("Id" uuid NOT NULL PRIMARY KEY, "ReporterPlayerId" uuid NOT NULL, "ReportedPlayerId" text NULL, "ReportedNickname" character varying(24) NOT NULL, "Reason" character varying(32) NOT NULL, "Details" character varying(500) NULL, "Status" character varying(24) NOT NULL, "CreatedAt" timestamp with time zone NOT NULL);
          CREATE INDEX IF NOT EXISTS "IX_player_reports_Status_CreatedAt" ON player_reports ("Status", "CreatedAt");
          CREATE TABLE IF NOT EXISTS remote_config ("Key" character varying(64) NOT NULL PRIMARY KEY, "Value" character varying(2048) NOT NULL, "UpdatedAt" timestamp with time zone NOT NULL);
          CREATE TABLE IF NOT EXISTS admin_audit_logs ("Id" uuid NOT NULL PRIMARY KEY, "AdminId" character varying(64) NOT NULL, "Action" character varying(64) NOT NULL, "Entity" character varying(128) NOT NULL, "OldValue" text NULL, "NewValue" text NULL, "IpAddress" text NULL, "CreatedAt" timestamp with time zone NOT NULL);
          CREATE INDEX IF NOT EXISTS "IX_admin_audit_logs_CreatedAt" ON admin_audit_logs ("CreatedAt");
          CREATE TABLE IF NOT EXISTS payment_purchases ("Id" uuid NOT NULL PRIMARY KEY, "Provider" character varying(24) NOT NULL, "ProviderTransactionId" character varying(160) NOT NULL, "PlayerId" uuid NOT NULL REFERENCES players ("Id") ON DELETE RESTRICT, "OfferId" character varying(48) NOT NULL, "Currency" character varying(8) NOT NULL, "AmountMinor" bigint NOT NULL, "GemsGranted" bigint NOT NULL, "Status" character varying(24) NOT NULL, "CreatedAt" timestamp with time zone NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS "IX_payment_purchases_Provider_ProviderTransactionId" ON payment_purchases ("Provider", "ProviderTransactionId");
          CREATE INDEX IF NOT EXISTS "IX_payment_purchases_PlayerId_CreatedAt" ON payment_purchases ("PlayerId", "CreatedAt");
          """;
    await db.Database.ExecuteSqlRawAsync(sql);
}

static async Task<PlayerProgressRecord> EnsurePlayerProgressAsync(SwarmDbContext db, Guid playerId, CancellationToken cancellationToken)
{
    var progress = await db.PlayerProgress.FindAsync([playerId], cancellationToken);
    if (progress is not null) return progress;
    progress = new PlayerProgressRecord { PlayerId = playerId, Level = 1, UpdatedAt = DateTimeOffset.UtcNow };
    db.PlayerProgress.Add(progress);
    return progress;
}

static int LevelFromExperience(long experience) => Math.Clamp(1 + (int)MathF.Floor(MathF.Sqrt(Math.Max(0, experience) / 100f)), 1, 100);

static async Task SeedProductDataAsync(SwarmDbContext db)
{
    if (await db.RemoteConfigs.AnyAsync()) return;
    var now = DateTimeOffset.UtcNow;
    db.RemoteConfigs.AddRange(RemoteConfigCatalog.Defaults.Select(pair => new RemoteConfigRecord { Key = pair.Key, Value = pair.Value, UpdatedAt = now }));
    await db.SaveChangesAsync();
}

static bool IsAdmin(HttpRequest request, string adminKey)
{
    if (string.IsNullOrWhiteSpace(adminKey)) return false;
    var supplied = request.Headers["X-Admin-Key"].ToString();
    if (supplied.Length != adminKey.Length) return false;
    return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(adminKey));
}

static bool VerifyStripeSignature(string payload, string signatureHeader, string secret)
{
    var parts = signatureHeader.Split(',', StringSplitOptions.RemoveEmptyEntries)
        .Select(part => part.Split('=', 2)).Where(part => part.Length == 2).ToArray();
    var timestampText = parts.FirstOrDefault(part => part[0] == "t")?.ElementAtOrDefault(1);
    if (!long.TryParse(timestampText, out var timestamp) || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp) > 300) return false;
    var expected = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{timestamp}.{payload}"))).ToLowerInvariant();
    return parts.Where(part => part[0] == "v1").Select(part => part[1]).Any(signature =>
        signature.Length == expected.Length && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(signature), Encoding.ASCII.GetBytes(expected)));
}

static string CreateAppleServerToken(string issuerId, string keyId, string privateKey, string bundleId)
{
    static string Encode(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    var header = Encode(JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", kid = keyId, typ = "JWT" }));
    var payload = Encode(JsonSerializer.SerializeToUtf8Bytes(new { iss = issuerId, iat = now, exp = now + 600, aud = "appstoreconnect-v1", bid = bundleId }));
    var content = $"{header}.{payload}";
    using var signer = ECDsa.Create();
    signer.ImportFromPem(privateKey.Replace("\\n", "\n"));
    var signature = signer.SignData(Encoding.ASCII.GetBytes(content), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
    return $"{content}.{Encode(signature)}";
}

static async Task<AppleTransactionInfo?> GetAppleTransactionAsync(HttpClient client, string transactionId, string jwt, CancellationToken cancellationToken)
{
    foreach (var host in new[] { "https://api.storekit.apple.com", "https://api.storekit-sandbox.apple.com" })
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{host}/inApps/v1/transactions/{Uri.EscapeDataString(transactionId)}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", jwt);
        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) continue;
        using var responseDocument = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var signedInfo = responseDocument.RootElement.GetProperty("signedTransactionInfo").GetString();
        if (string.IsNullOrWhiteSpace(signedInfo)) return null;
        var parts = signedInfo.Split('.');
        if (parts.Length != 3) return null;
        var value = parts[1].Replace('-', '+').Replace('_', '/');
        value += new string('=', (4 - value.Length % 4) % 4);
        using var transactionDocument = JsonDocument.Parse(Convert.FromBase64String(value));
        var root = transactionDocument.RootElement;
        return new AppleTransactionInfo(
            root.GetProperty("transactionId").GetString() ?? string.Empty,
            root.GetProperty("productId").GetString() ?? string.Empty,
            root.GetProperty("bundleId").GetString() ?? string.Empty,
            root.TryGetProperty("currency", out var currency) ? currency.GetString() : null,
            root.TryGetProperty("price", out var price) && price.TryGetInt64(out var amount) ? amount : null,
            root.TryGetProperty("revocationDate", out _));
    }
    return null;
}

static IResult ApiError(string code, string message, int status = StatusCodes.Status400BadRequest)
    => Results.Json(new { success = false, code, message }, statusCode: status);

public sealed class FriendRoomRegistry
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(2);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _rooms = new(StringComparer.OrdinalIgnoreCase);

    public string Create()
    {
        RemoveExpired();
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var code = GenerateRoomCode();
            if (_rooms.TryAdd(code, DateTimeOffset.UtcNow.Add(Lifetime))) return code;
        }
        throw new InvalidOperationException("A unique friend room code could not be generated.");
    }

    public bool Exists(string code)
    {
        if (!_rooms.TryGetValue(code, out var expiresAt)) return false;
        if (expiresAt > DateTimeOffset.UtcNow) return true;
        _rooms.TryRemove(code, out _);
        return false;
    }

    private void RemoveExpired()
    {
        foreach (var room in _rooms.Where(pair => pair.Value <= DateTimeOffset.UtcNow).ToArray()) _rooms.TryRemove(room.Key, out _);
    }

    private static string GenerateRoomCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Span<byte> bytes = stackalloc byte[4];
        RandomNumberGenerator.Fill(bytes);
        var characters = new char[4];
        for (var index = 0; index < characters.Length; index++) characters[index] = alphabet[bytes[index] % alphabet.Length];
        return $"SW-{new string(characters)}";
    }
}

public sealed record GuestLoginRequest(string DeviceId, string? Nickname);
public sealed record GuestLoginResponse(string AccessToken, PlayerResponse Player);
public sealed record PlayerResponse(Guid Id, string Nickname, long Coins, long Gems, string EquippedSkin);
public sealed record MatchRewardRequest(string ResultToken);
public sealed record CosmeticActionRequest(string ItemId);
public sealed record InventoryItemResponse(string ItemId, bool IsEquipped, DateTimeOffset AcquiredAt);
public sealed record CosmeticItemResponse(
    string Id, string Name, string Rarity, long Price, string Currency, string Description,
    string TraitName, string TraitDescription);
public sealed record PlayerReportRequest(string ReportedNickname, string Reason, string? ReportedPlayerId, string? Details);
public sealed record AnalyticsEventRequest(string Name, Dictionary<string, string>? Properties);
public sealed record RemoteConfigRequest(string Value);
public sealed record WebCheckoutRequest(string OfferId);
public sealed record ApplePurchaseRequest(string OfferId, string ProductId, string TransactionId, string? SignedTransaction);
public sealed record AppleTransactionInfo(string TransactionId, string ProductId, string BundleId, string? Currency, long? Price, bool Revoked);
public sealed record PaymentOffer(string Id, string Title, long Gems, string BonusLabel, string WebPriceLabel, string StripePriceEnvironmentKey, string AppleProductId, string GoogleProductId);
public sealed record MissionResponse(string Id, string Title, string Period, int Progress, int Target, int Coins, int Xp, bool Complete);
public sealed record SeasonResponse(string Id, string Name, int Level, long Xp, long CurrentLevelXp, long NextLevelXp, int MaxLevel, DateTimeOffset EndsAt);

static class CosmeticCatalog
{
    public static readonly CosmeticItemResponse[] All =
    [
        new("starter", "Starter Core", "Ücretsiz", 0, "Coins", "Temiz ve dengeli başlangıç çekirdeği.", "SINIR DİRENCİ", "Sınır enerji cezası %20 daha az."),
        new("neon", "Neon Bloom", "Nadir", 200, "Coins", "Mor enerji yaprakları ve canlı çekirdek parıltısı.", "GENİŞ ÇEKİM", "Çekim menzili %35 daha geniş."),
        new("hex", "Armored Hex", "Nadir", 450, "Coins", "Altıgen zırh plakaları ve güçlü cyan çerçeve.", "UZUN KALKAN", "Kalkan %40 daha uzun sürer."),
        new("solar", "Solar Crown", "Destansı", 900, "Coins", "Güneş ışınlarıyla çevrili altın enerji kabuğu.", "GÜNEŞ HASADI", "Toplanan enerji %15 daha değerlidir."),
        new("void", "Void Phantom", "Destansı", 220, "Gems", "Karanlık çekirdek çevresinde dönen mor halkalar.", "FANTOM AKIŞ", "Hareket hızı %10 daha yüksektir."),
        new("gold", "Golden Sovereign", "Efsanevi", 350, "Gems", "Beyaz-altın zırh, taç ve kraliyet halkaları.", "KRALİYET ATILIŞI", "Atıl gücü %25 daha yüksektir.")
    ];

    public static CosmeticItemResponse? Find(string? itemId)
        => All.FirstOrDefault(x => string.Equals(x.Id, itemId, StringComparison.OrdinalIgnoreCase));
}

static class PaymentCatalog
{
    public static readonly PaymentOffer[] All =
    [
        new("spark", "Kıvılcım Paketi", 80, "", "₺39,99", "STRIPE_PRICE_SPARK", "io.swarm.gems.spark", "io.swarm.gems.spark"),
        new("nova", "Nova Paketi", 250, "+%25 bonus", "₺99,99", "STRIPE_PRICE_NOVA", "io.swarm.gems.nova", "io.swarm.gems.nova"),
        new("galaxy", "Galaksi Paketi", 700, "+%40 bonus", "₺249,99", "STRIPE_PRICE_GALAXY", "io.swarm.gems.galaxy", "io.swarm.gems.galaxy")
    ];
    public static PaymentOffer? Find(string? id) => All.FirstOrDefault(item => string.Equals(item.Id, id, StringComparison.OrdinalIgnoreCase));
}

static class MissionCatalog
{
    public static MissionResponse[] Build(PlayerProgressRecord progress, IReadOnlyCollection<MatchRecord> today)
    {
        var matches = today.Count;
        var kills = today.Sum(x => x.Kills);
        var score = today.Sum(x => x.Score);
        return
        [
            Mission("daily-play-3", "3 maç oyna", "GÜNLÜK", matches, 3, 100, 120),
            Mission("daily-kills-5", "5 rakip avla", "GÜNLÜK", kills, 5, 125, 150),
            Mission("daily-score-1000", "1.000 enerji topla", "GÜNLÜK", score, 1000, 150, 180),
            Mission("weekly-play-20", "20 maç tamamla", "HAFTALIK", progress.TotalMatches % 20, 20, 500, 600)
        ];
    }
    private static MissionResponse Mission(string id, string title, string period, int progress, int target, int coins, int xp)
        => new(id, title, period, Math.Min(progress, target), target, coins, xp, progress >= target);
}

static class SeasonCatalog
{
    private const int XpPerLevel = 500;
    public static SeasonResponse Build(long xp)
    {
        var level = Math.Clamp(1 + (int)(xp / XpPerLevel), 1, 50);
        return new("cosmic-rise-01", "COSMIC RISE", level, xp, xp % XpPerLevel, XpPerLevel, 50, new DateTimeOffset(2026, 11, 30, 20, 59, 59, TimeSpan.Zero));
    }
}

static class AnalyticsCatalog
{
    public static readonly HashSet<string> Allowed = new(StringComparer.Ordinal)
    {
        "app_open", "session_start", "session_end", "match_start", "match_end", "player_kill", "player_death",
        "energy_collected", "ability_used", "skin_viewed", "skin_equipped", "shop_open", "item_purchased",
        "reward_claimed", "ad_started", "ad_completed", "mission_completed", "level_up", "season_progress"
    };
}

static class RemoteConfigCatalog
{
    public static readonly Dictionary<string, string> Defaults = new()
    {
        ["MAINTENANCE_MODE"] = "false", ["ENABLE_BATTLE_PASS"] = "true", ["ENABLE_TEAM_MODE"] = "false", ["ENABLE_IAP"] = "true",
        ["ENABLE_ADS"] = "false", ["ENABLE_NEW_EVENT"] = "true", ["ENABLE_RANKED"] = "false",
        ["PLAYER_BASE_SPEED"] = "230", ["GROWTH_RATE"] = "0.7", ["DASH_COOLDOWN_SECONDS"] = "4",
        ["SHIELD_COOLDOWN_SECONDS"] = "15", ["MAGNET_COOLDOWN_SECONDS"] = "13",
        ["ARENA_MAX_PLAYERS"] = "50", ["ARENA_TARGET_POPULATION"] = "24"
    };
    public static readonly HashSet<string> Keys = new(Defaults.Keys, StringComparer.Ordinal);
}
