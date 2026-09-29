namespace Swarm.Domain;

public enum CurrencyType { Coins = 1, Gems = 2 }

public sealed record CurrencyTransaction(Guid Id, Guid PlayerId, CurrencyType Currency, long Amount, string Reason, string IdempotencyKey, DateTimeOffset CreatedAt);
