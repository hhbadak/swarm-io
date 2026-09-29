using Swarm.Application;
using Swarm.Domain;

var tests = new (string Name, Action Run)[]
{
    ("Token round-trip", TokenRoundTrip), ("Expired token rejected", ExpiredTokenRejected),
    ("Movement clamped", MovementClamped), ("Input normalized", InputNormalized), ("Dash accelerates", DashAccelerates),
    ("Shield activates and cools down", ShieldActivates), ("Magnet activates", MagnetActivates),
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
