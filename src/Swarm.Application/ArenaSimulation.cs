using Swarm.Domain;

namespace Swarm.Application;

public sealed class ArenaSimulation
{
    public const float ArenaWidth = 3200;
    public const float ArenaHeight = 1800;
    public const int MaxPlayers = 50;
    public const int TargetPopulation = 24;
    private const float BaseSpeed = 230;
    private const int TargetEnergyCount = 300;
    private readonly Dictionary<Guid, ArenaPlayer> _players = new();
    private readonly Dictionary<Guid, EnergyOrb> _energy = new();
    private readonly HashSet<Guid> _botIds = new();
    private readonly Dictionary<Guid, long> _dashUntilTick = new();
    private readonly Dictionary<Guid, long> _dashReadyTick = new();
    private readonly Dictionary<Guid, Vector2> _dashDirection = new();
    private readonly Dictionary<Guid, Vector2> _lastMovementInput = new();
    private readonly Dictionary<Guid, long> _invulnerableUntilTick = new();
    private readonly Dictionary<Guid, long> _shieldUntilTick = new();
    private readonly Dictionary<Guid, long> _shieldReadyTick = new();
    private readonly Dictionary<Guid, long> _magnetUntilTick = new();
    private readonly Dictionary<Guid, long> _magnetReadyTick = new();
    private readonly Dictionary<Guid, long> _boundaryPenaltyReadyTick = new();
    private readonly Dictionary<Guid, int> _zeroBoundaryHits = new();
    private readonly ArenaZone[] _zones =
    {
        new("speed-north", "speed", new Vector2(800, 430), 240),
        new("gold-south", "gold", new Vector2(2420, 1380), 260),
        new("gravity-core", "gravity", new Vector2(1600, 900), 210)
    };
    private readonly Random _random;
    private long _tick;
    private int _botSequence;

    private static readonly string[] BotNames =
    [
        "Vortex", "Toxic", "Nyx", "Blaze", "Khan", "Pixel", "Orion", "Ghost", "Razor", "Luna", "Apex",
        "Volt", "Mamba", "Comet", "Hex", "Frost", "Venom", "Drift", "Echo", "Onyx", "Flux", "Titan",
        "Pulsar", "Vega", "Lyra", "Atlas", "Astra", "NovaBot", "Quasar", "Cipher", "Jade", "Ember",
        "Rift", "Halo", "Ion", "Kite", "Mira", "Nexus", "Orbit", "Prism", "Rune", "Sonic", "Talon",
        "Umbra", "Wave", "Xeno", "Yuki", "Zen", "Cosmo", "Bolt"
    ];

    public ArenaSimulation(int seed = 149)
    {
        _random = new Random(seed);
        RefillEnergy();
        RebalanceBots();
    }

    public int RealPlayerCount => _players.Values.Count(player => !player.IsBot);
    public int BotCount => _botIds.Count;
    public int PlayerCount => _players.Count;
    public bool HasCapacity => RealPlayerCount < MaxPlayers;

    public static float MovementSpeedFor(float radius, float traitMultiplier = 1)
    {
        var sizeMultiplier = MathF.Max(1, radius / 18);
        return MathF.Max(72, BaseSpeed / MathF.Pow(sizeMultiplier, 0.72f)) * traitMultiplier;
    }

    public ArenaPlayer AddPlayer(Guid id, string nickname, string skinId = "starter")
    {
        if (_players.TryGetValue(id, out var existing) && existing.Alive)
        {
            _players[id] = existing with { Nickname = nickname, SkinId = skinId };
            return _players[id];
        }
        if (!HasCapacity) throw new InvalidOperationException("Arena is full.");
        var player = CreatePlayer(id, nickname, false, 0, skinId);
        _players[id] = player;
        _invulnerableUntilTick[id] = _tick + 60;
        RebalanceBots();
        return player;
    }

    public void RemovePlayer(Guid id)
    {
        if (!_botIds.Contains(id))
        {
            _players.Remove(id);
            _invulnerableUntilTick.Remove(id);
            _dashDirection.Remove(id);
            _lastMovementInput.Remove(id);
            _boundaryPenaltyReadyTick.Remove(id);
            _zeroBoundaryHits.Remove(id);
            RebalanceBots();
        }
    }

    public bool SetInput(Guid id, Vector2 input)
    {
        if (!_players.TryGetValue(id, out var player)) return false;
        var normalized = input.Normalized;
        if (normalized.Length > 0.0001f) _lastMovementInput[id] = normalized;
        _players[id] = player with { Input = normalized };
        return true;
    }

    public bool RequestDash(Guid id)
    {
        if (!_players.TryGetValue(id, out var player) || !player.Alive) return false;
        if (_dashReadyTick.TryGetValue(id, out var readyAt) && _tick < readyAt) return false;
        _dashDirection[id] = player.Input.Length > 0.0001f
            ? player.Input
            : _lastMovementInput.GetValueOrDefault(id, new Vector2(0, -1));
        _dashUntilTick[id] = _tick + 6;
        _dashReadyTick[id] = _tick + 80;
        return true;
    }

    public bool RequestAbility(Guid id, string ability)
    {
        if (!_players.TryGetValue(id, out var player) || !player.Alive) return false;
        if (string.Equals(ability, "shield", StringComparison.OrdinalIgnoreCase))
        {
            if (_shieldReadyTick.TryGetValue(id, out var readyAt) && _tick < readyAt) return false;
            var duration = (long)MathF.Round(60 * CharacterTraits.For(player.SkinId).ShieldDurationMultiplier);
            _shieldUntilTick[id] = _tick + duration;
            _shieldReadyTick[id] = _tick + 300;
            return true;
        }
        if (string.Equals(ability, "magnet", StringComparison.OrdinalIgnoreCase))
        {
            if (_magnetReadyTick.TryGetValue(id, out var readyAt) && _tick < readyAt) return false;
            _magnetUntilTick[id] = _tick + 100;
            _magnetReadyTick[id] = _tick + 260;
            return true;
        }
        return false;
    }

    public ArenaSnapshot Step(TimeSpan elapsed)
    {
        var seconds = Math.Clamp((float)elapsed.TotalSeconds, 0, 0.1f);
        UpdateBots();
        var energyAtStart = _energy.Values.ToArray();
        foreach (var pair in _players.ToArray())
        {
            var player = pair.Value;
            if (!player.Alive) continue;
            var trait = CharacterTraits.For(player.SkinId);
            var speed = MovementSpeedFor(player.Radius, trait.SpeedMultiplier);
            var dashActive = _dashUntilTick.TryGetValue(player.Id, out var dashUntil) && _tick < dashUntil;
            if (dashActive) speed *= 1.85f * trait.DashMultiplier;
            if (InsideZone(player.Position, "speed")) speed *= 1.3f;
            var movementInput = player.Input.Length > 0.0001f
                ? player.Input
                : dashActive ? _dashDirection.GetValueOrDefault(player.Id, new Vector2(0, -1)) : player.Input;
            var next = player.Position + (movementInput * speed * seconds);
            if (InsideZone(player.Position, "gravity"))
            {
                var gravity = _zones.First(zone => zone.Kind == "gravity");
                var pull = new Vector2(gravity.Position.X - player.Position.X, gravity.Position.Y - player.Position.Y).Normalized;
                next += pull * 55 * seconds;
            }
            var hitBoundary = next.X <= player.Radius || next.X >= ArenaWidth - player.Radius
                || next.Y <= player.Radius || next.Y >= ArenaHeight - player.Radius;
            player = player with
            {
                Position = new Vector2(
                    Math.Clamp(next.X, player.Radius, ArenaWidth - player.Radius),
                    Math.Clamp(next.Y, player.Radius, ArenaHeight - player.Radius))
            };
            if (hitBoundary && (!_boundaryPenaltyReadyTick.TryGetValue(player.Id, out var penaltyReadyAt) || _tick >= penaltyReadyAt))
            {
                var basePenalty = Math.Max(4, (int)Math.Ceiling(player.Score * 0.04));
                var adjustedPenalty = Math.Max(1, (int)MathF.Floor(basePenalty * trait.BoundaryPenaltyMultiplier));
                var penalty = Math.Min(player.Score, adjustedPenalty);
                var reducedScore = Math.Max(0, player.Score - penalty);
                var zeroHits = reducedScore == 0 ? _zeroBoundaryHits.GetValueOrDefault(player.Id) + 1 : 0;
                _zeroBoundaryHits[player.Id] = zeroHits;
                player = player with { Score = reducedScore, Radius = 18 + MathF.Sqrt(reducedScore) * 0.7f, Alive = zeroHits < 3 };
                _boundaryPenaltyReadyTick[player.Id] = _tick + 14;
            }
            else if (!hitBoundary)
            {
                _zeroBoundaryHits[player.Id] = 0;
            }
            if (!player.Alive)
            {
                _players[pair.Key] = player with { Input = new Vector2(0, 0) };
                continue;
            }
            var shieldActive = _shieldUntilTick.TryGetValue(player.Id, out var shieldUntil) && _tick < shieldUntil;
            var magnetActive = _magnetUntilTick.TryGetValue(player.Id, out var magnetUntil) && _tick < magnetUntil;
            player = player with { ShieldActive = shieldActive, MagnetActive = magnetActive };
            foreach (var orb in energyAtStart)
            {
                if (!_energy.ContainsKey(orb.Id)) continue;
                var dx = player.Position.X - orb.Position.X;
                var dy = player.Position.Y - orb.Position.Y;
                var reach = player.Radius + (magnetActive ? 115 * trait.MagnetReachMultiplier : 8);
                if ((dx * dx) + (dy * dy) > reach * reach) continue;
                _energy.Remove(orb.Id);
                var zoneMultiplier = InsideZone(player.Position, "gold") ? 2 : 1;
                var eventMultiplier = ActiveEvent() is not null ? 2 : 1;
                var traitValue = Math.Max(orb.Value, (int)MathF.Round(orb.Value * trait.EnergyValueMultiplier));
                var nextScore = player.Score + (traitValue * zoneMultiplier * eventMultiplier);
                player = player with { Score = nextScore, Radius = 18 + MathF.Sqrt(nextScore) * 0.7f };
            }
            _players[pair.Key] = player;
        }
        ResolvePlayerCollisions();
        RefillEnergy();
        _tick++;
        return Snapshot();
    }

    public ArenaSnapshot Snapshot() => new(_tick, _players.Values.ToArray(), _energy.Values.ToArray(), _zones, ActiveEvent());

    private void RefillEnergy()
    {
        while (_energy.Count < TargetEnergyCount)
        {
            var roll = _random.NextDouble();
            var (value, kind) = roll switch
            {
                < 0.012 => (30, "core"),
                < 0.06 => (15, "epic"),
                < 0.20 => (5, "rare"),
                _ => (1, "common")
            };
            var orb = new EnergyOrb(Guid.NewGuid(), RandomPosition(), value, kind);
            _energy[orb.Id] = orb;
        }
    }

    private ArenaPlayer CreatePlayer(Guid id, string nickname, bool isBot, int score, string skinId)
        => new(id, nickname, skinId, RandomPosition(), new Vector2(0, 0), score, 0, 18 + MathF.Sqrt(score) * 0.7f, true, isBot, false, false);

    private static string BotSkin(string nickname)
    {
        var skins = new[] { "starter", "neon", "hex", "solar", "void", "gold" };
        return skins[Math.Abs(StringComparer.Ordinal.GetHashCode(nickname)) % skins.Length];
    }

    private void RebalanceBots()
    {
        var desiredBots = Math.Clamp(TargetPopulation - RealPlayerCount, 0, MaxPlayers - RealPlayerCount);
        while (_botIds.Count > desiredBots)
        {
            var botId = _botIds.First();
            _botIds.Remove(botId);
            RemovePlayerState(botId);
        }
        while (_botIds.Count < desiredBots)
        {
            var name = BotNames[_botSequence % BotNames.Length];
            if (_botSequence >= BotNames.Length) name = $"{name}-{1 + (_botSequence / BotNames.Length)}";
            _botSequence++;
            var id = Guid.NewGuid();
            _botIds.Add(id);
            _players[id] = CreatePlayer(id, name, true, _random.Next(0, 80), BotSkin(name));
        }
    }

    private void RemovePlayerState(Guid id)
    {
        _players.Remove(id);
        _invulnerableUntilTick.Remove(id);
        _dashDirection.Remove(id);
        _lastMovementInput.Remove(id);
        _boundaryPenaltyReadyTick.Remove(id);
        _zeroBoundaryHits.Remove(id);
        _shieldUntilTick.Remove(id);
        _shieldReadyTick.Remove(id);
        _magnetUntilTick.Remove(id);
        _magnetReadyTick.Remove(id);
    }

    private void UpdateBots()
    {
        foreach (var botId in _botIds)
        {
            if (!_players.TryGetValue(botId, out var bot)) continue;
            if (!bot.Alive)
            {
                _players[botId] = CreatePlayer(botId, bot.Nickname, true, _random.Next(0, 30), bot.SkinId);
                continue;
            }

            EnergyOrb? target = null;
            var bestScore = float.MaxValue;
            foreach (var orb in _energy.Values)
            {
                var score = DistanceSquared(bot.Position, orb.Position) / Math.Max(1, orb.Value);
                if (score >= bestScore) continue;
                bestScore = score;
                target = orb;
            }
            if (target is not null) _players[botId] = bot with { Input = new Vector2(target.Position.X - bot.Position.X, target.Position.Y - bot.Position.Y).Normalized };
        }
    }

    private void ResolvePlayerCollisions()
    {
        var alive = _players.Values.Where(player => player.Alive).ToArray();
        for (var i = 0; i < alive.Length; i++)
        {
            for (var j = i + 1; j < alive.Length; j++)
            {
                var first = _players[alive[i].Id];
                var second = _players[alive[j].Id];
                if (!first.Alive || !second.Alive) continue;
                if ((_invulnerableUntilTick.TryGetValue(first.Id, out var firstSafeUntil) && _tick < firstSafeUntil)
                    || (_invulnerableUntilTick.TryGetValue(second.Id, out var secondSafeUntil) && _tick < secondSafeUntil)) continue;
                var distance = DistanceSquared(first.Position, second.Position);
                var collisionDistance = MathF.Max(12, (first.Radius + second.Radius) * 0.72f);
                if (distance > collisionDistance * collisionDistance) continue;

                ArenaPlayer hunter;
                ArenaPlayer victim;
                if (first.Radius > second.Radius * 1.025f) { hunter = first; victim = second; }
                else if (second.Radius > first.Radius * 1.025f) { hunter = second; victim = first; }
                else continue;

                if (victim.ShieldActive) continue;

                var gainedScore = 25 + (victim.Score / 2);
                var nextScore = hunter.Score + gainedScore;
                _players[hunter.Id] = hunter with { Score = nextScore, Kills = hunter.Kills + 1, Radius = 18 + MathF.Sqrt(nextScore) * 0.7f };
                _players[victim.Id] = victim with { Alive = false, Input = new Vector2(0, 0) };
            }
        }
    }

    private static float DistanceSquared(Vector2 first, Vector2 second)
    {
        var dx = first.X - second.X;
        var dy = first.Y - second.Y;
        return (dx * dx) + (dy * dy);
    }

    private Vector2 RandomPosition() => new(_random.NextSingle() * ArenaWidth, _random.NextSingle() * ArenaHeight);

    private bool InsideZone(Vector2 position, string kind)
    {
        var zone = _zones.First(candidate => candidate.Kind == kind);
        return DistanceSquared(position, zone.Position) <= zone.Radius * zone.Radius;
    }

    private ArenaEvent? ActiveEvent()
    {
        const int cycle = 900;
        const int duration = 180;
        var point = _tick % cycle;
        return point >= cycle - duration
            ? new ArenaEvent("energyStorm", _tick + (cycle - point), "ENERJİ FIRTINASI · TÜM YEMLER 2X")
            : null;
    }
}
