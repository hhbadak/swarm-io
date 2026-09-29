using Swarm.Application;
using Swarm.Domain;

var tests = new (string Name, Action Run)[]
{
    ("Token round-trip", TokenRoundTrip), ("Expired token rejected", ExpiredTokenRejected),
    ("Movement clamped", MovementClamped), ("Input normalized", InputNormalized), ("Dash accelerates", DashAccelerates),
    ("Stationary dash uses last direction", StationaryDashUsesLastDirection), ("Zero energy boundary contact kills", ZeroEnergyBoundaryContactKills),
    ("Shield activates and cools down", ShieldActivates), ("Magnet activates", MagnetActivates),
    ("Every character has a unique trait", EveryCharacterHasUniqueTrait), ("Character traits affect simulation", CharacterTraitsAffectSimulation),
    ("Arena has zones and rarity", ArenaHasProductSystems), ("Reconnect preserves player", ReconnectPreservesPlayer)
};
var failures = 0;
foreach (var test in tests)
{
    try { test.Run(); Console.WriteLine($"PASS {test.Name}"); }
    catch (Exception exception) { failures++; Console.Error.WriteLine($"FAIL {test.Name}: {exception.Message}"); }
}
return failures;

static void TokenRoundTrip()
{
    var service = new SwarmTokenService("12345678901234567890123456789012");
    var id = Guid.NewGuid();
    var token = service.Issue(id, "Nova", "match", TimeSpan.FromMinutes(1));
    Assert(service.TryValidate(token, "match", out var payload), "Token should validate.");
    Assert(payload.PlayerId == id, "Player id should survive round-trip.");
    Assert(!service.TryValidate(token, "access", out _), "Purpose must be enforced.");
}
static void ExpiredTokenRejected()
{
    var service = new SwarmTokenService("12345678901234567890123456789012");
    var token = service.Issue(Guid.NewGuid(), "Nova", "match", TimeSpan.FromSeconds(-1));
    Assert(!service.TryValidate(token, "match", out _), "Expired token should be rejected.");
}
static void MovementClamped()
{
    var simulation = new ArenaSimulation(1);
    var player = simulation.AddPlayer(Guid.NewGuid(), "Nova");
    simulation.SetInput(player.Id, new Vector2(10_000, 10_000));
    for (var i = 0; i < 1000; i++) simulation.Step(TimeSpan.FromMilliseconds(50));
    var moved = simulation.Snapshot().Players.Single(x => x.Id == player.Id);
    Assert(moved.Position.X <= ArenaSimulation.ArenaWidth && moved.Position.Y <= ArenaSimulation.ArenaHeight, "Player must remain inside arena.");
}
static void InputNormalized()
{
    var vector = new Vector2(10, 0).Normalized;
    Assert(Math.Abs(vector.Length - 1) < 0.001f, "Input vector must be normalized.");
}
static void DashAccelerates()
{
    var id = Guid.NewGuid();
    var normal = new ArenaSimulation(42);
    var normalPlayer = normal.AddPlayer(id, "Nova");
    normal.SetInput(id, new Vector2(1, 0));
    normal.Step(TimeSpan.FromMilliseconds(50));
    var normalDistance = normal.Snapshot().Players.Single(x => x.Id == id).Position.X - normalPlayer.Position.X;

    var boosted = new ArenaSimulation(42);
    var boostedPlayer = boosted.AddPlayer(id, "Nova");
    boosted.SetInput(id, new Vector2(1, 0));
    boosted.RequestDash(id);
    boosted.Step(TimeSpan.FromMilliseconds(50));
    var boostedDistance = boosted.Snapshot().Players.Single(x => x.Id == id).Position.X - boostedPlayer.Position.X;
    Assert(boostedDistance > normalDistance, "Dash must move farther than normal movement.");
}
static void StationaryDashUsesLastDirection()
{
    var simulation = new ArenaSimulation(43);
    var player = simulation.AddPlayer(Guid.NewGuid(), "Nova");
    simulation.SetInput(player.Id, new Vector2(1, 0));
    simulation.SetInput(player.Id, new Vector2(0, 0));
    Assert(simulation.RequestDash(player.Id), "Dash should activate while stationary.");
    simulation.Step(TimeSpan.FromMilliseconds(50));
    var moved = simulation.Snapshot().Players.Single(x => x.Id == player.Id);
    Assert(moved.Position.X > player.Position.X, "Stationary dash must use the last movement direction.");
}
static void ZeroEnergyBoundaryContactKills()
{
    var simulation = new ArenaSimulation(44);
    var player = simulation.AddPlayer(Guid.NewGuid(), "Nova");
    var distances = new[] { player.Position.X, ArenaSimulation.ArenaWidth - player.Position.X, player.Position.Y, ArenaSimulation.ArenaHeight - player.Position.Y };
    var direction = Array.IndexOf(distances, distances.Min()) switch
    {
        0 => new Vector2(-1, 0),
        1 => new Vector2(1, 0),
        2 => new Vector2(0, -1),
        _ => new Vector2(0, 1)
    };
    simulation.SetInput(player.Id, direction);
    for (var i = 0; i < 240 && simulation.Snapshot().Players.Single(x => x.Id == player.Id).Alive; i++)
        simulation.Step(TimeSpan.FromMilliseconds(100));
    var finished = simulation.Snapshot().Players.Single(x => x.Id == player.Id);
    Assert(!finished.Alive && finished.Score == 0, "A zero-energy player who stays on the boundary must die.");
}
static void ShieldActivates()
{
    var simulation = new ArenaSimulation(7);
    var player = simulation.AddPlayer(Guid.NewGuid(), "Nova");
    Assert(simulation.RequestAbility(player.Id, "shield"), "Shield should activate when ready.");
    Assert(!simulation.RequestAbility(player.Id, "shield"), "Shield cooldown must be enforced.");
    simulation.Step(TimeSpan.FromMilliseconds(50));
    Assert(simulation.Snapshot().Players.Single(x => x.Id == player.Id).ShieldActive, "Shield state must be in snapshot.");
}
static void MagnetActivates()
{
    var simulation = new ArenaSimulation(9);
    var player = simulation.AddPlayer(Guid.NewGuid(), "Nova");
    Assert(simulation.RequestAbility(player.Id, "magnet"), "Magnet should activate when ready.");
    simulation.Step(TimeSpan.FromMilliseconds(50));
    Assert(simulation.Snapshot().Players.Single(x => x.Id == player.Id).MagnetActive, "Magnet state must be in snapshot.");
}
static void EveryCharacterHasUniqueTrait()
{
    var starter = CharacterTraits.For("starter");
    var neon = CharacterTraits.For("neon");
    var hex = CharacterTraits.For("hex");
    var solar = CharacterTraits.For("solar");
    var voidTrait = CharacterTraits.For("void");
    var gold = CharacterTraits.For("gold");
    Assert(starter.BoundaryPenaltyMultiplier < 1, "Starter must reduce boundary penalties.");
    Assert(neon.MagnetReachMultiplier > 1, "Neon must increase magnet reach.");
    Assert(hex.ShieldDurationMultiplier > 1, "Hex must extend shield duration.");
    Assert(solar.EnergyValueMultiplier > 1, "Solar must increase collected energy value.");
    Assert(voidTrait.SpeedMultiplier > 1, "Void must increase movement speed.");
    Assert(gold.DashMultiplier > 1, "Gold must increase dash power.");
}
static void CharacterTraitsAffectSimulation()
{
    var id = Guid.NewGuid();
    var starter = new ArenaSimulation(77);
    var starterPlayer = starter.AddPlayer(id, "Nova", "starter");
    starter.SetInput(id, new Vector2(1, 0));
    starter.Step(TimeSpan.FromMilliseconds(50));
    var starterDistance = starter.Snapshot().Players.Single(x => x.Id == id).Position.X - starterPlayer.Position.X;

    var voidArena = new ArenaSimulation(77);
    var voidPlayer = voidArena.AddPlayer(id, "Nova", "void");
    voidArena.SetInput(id, new Vector2(1, 0));
    voidArena.Step(TimeSpan.FromMilliseconds(50));
    var voidDistance = voidArena.Snapshot().Players.Single(x => x.Id == id).Position.X - voidPlayer.Position.X;
    Assert(voidDistance > starterDistance, "Void speed trait must affect movement.");

    var hexArena = new ArenaSimulation(78);
    var hexPlayer = hexArena.AddPlayer(Guid.NewGuid(), "Nova", "hex");
    hexArena.RequestAbility(hexPlayer.Id, "shield");
    for (var i = 0; i < 65; i++) hexArena.Step(TimeSpan.FromMilliseconds(20));
    Assert(hexArena.Snapshot().Players.Single(x => x.Id == hexPlayer.Id).ShieldActive, "Hex shield trait must outlast the default shield.");
}
static void ArenaHasProductSystems()
{
    var snapshot = new ArenaSimulation(149).Snapshot();
    Assert(snapshot.Zones.Count >= 3, "Arena must expose gameplay zones.");
    Assert(snapshot.Energy.Any(x => x.Kind != "common"), "Seeded arena must contain rare energy.");
    Assert(snapshot.Energy.All(x => x.Value is 1 or 5 or 15 or 30), "Energy values must match rarity table.");
}
static void ReconnectPreservesPlayer()
{
    var simulation = new ArenaSimulation(21);
    var id = Guid.NewGuid();
    var player = simulation.AddPlayer(id, "Nova", "neon");
    simulation.SetInput(id, new Vector2(1, 0));
    simulation.Step(TimeSpan.FromMilliseconds(50));
    var before = simulation.Snapshot().Players.Single(x => x.Id == id);
    var reconnected = simulation.AddPlayer(id, "Nova", "neon");
    Assert(reconnected.Position == before.Position && reconnected.SkinId == "neon", "Reconnect must keep live arena state.");
}
static void Assert(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
