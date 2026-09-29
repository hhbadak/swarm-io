using System.Text.Json.Serialization;

namespace Swarm.Domain;

public readonly record struct Vector2(float X, float Y)
{
    [JsonIgnore]
    public float Length => MathF.Sqrt((X * X) + (Y * Y));
    [JsonIgnore]
    public Vector2 Normalized => Length <= 0.0001f ? new Vector2(0, 0) : new Vector2(X / Length, Y / Length);
    public static Vector2 operator +(Vector2 left, Vector2 right) => new(left.X + right.X, left.Y + right.Y);
    public static Vector2 operator *(Vector2 vector, float scale) => new(vector.X * scale, vector.Y * scale);
}

public sealed record ArenaPlayer(
    Guid Id, string Nickname, string SkinId, Vector2 Position, Vector2 Input,
    int Score, int Kills, float Radius, bool Alive, bool IsBot,
    bool ShieldActive, bool MagnetActive);

public sealed record EnergyOrb(Guid Id, Vector2 Position, int Value, string Kind);
public sealed record ArenaZone(string Id, string Kind, Vector2 Position, float Radius);
public sealed record ArenaEvent(string Kind, long EndsAtTick, string Message);
public sealed record ArenaSnapshot(
    long Tick,
    IReadOnlyCollection<ArenaPlayer> Players,
    IReadOnlyCollection<EnergyOrb> Energy,
    IReadOnlyCollection<ArenaZone> Zones,
    ArenaEvent? Event);
