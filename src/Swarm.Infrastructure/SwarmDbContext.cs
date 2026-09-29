using Microsoft.EntityFrameworkCore;

namespace Swarm.Infrastructure;

public sealed class PlayerRecord
{
    public Guid Id { get; set; }
    public required string DeviceIdHash { get; set; }
    public required string Nickname { get; set; }
    public long Coins { get; set; }
    public long Gems { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class CurrencyTransactionRecord
{
    public Guid Id { get; set; }
    public Guid PlayerId { get; set; }
    public required string Currency { get; set; }
    public long Amount { get; set; }
    public required string Reason { get; set; }
    public required string IdempotencyKey { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class PlayerCosmeticRecord
{
    public Guid Id { get; set; }
    public Guid PlayerId { get; set; }
    public required string ItemId { get; set; }
    public DateTimeOffset AcquiredAt { get; set; }
    public bool IsEquipped { get; set; }
}

public sealed class PlayerProgressRecord
{
    public Guid PlayerId { get; set; }
    public long Experience { get; set; }
    public int Level { get; set; } = 1;
    public int TotalMatches { get; set; }
    public int Wins { get; set; }
    public int TotalKills { get; set; }
    public int BestScore { get; set; }
    public int HighestRank { get; set; }
    public long SeasonXp { get; set; }
    public int DailyStreak { get; set; }
    public DateTimeOffset? LastDailyClaimAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class MatchRecord
{
    public Guid Id { get; set; }
    public Guid PlayerId { get; set; }
    public int Score { get; set; }
    public int Kills { get; set; }
    public int Rank { get; set; }
    public int DurationSeconds { get; set; }
    public long CoinsEarned { get; set; }
    public long XpEarned { get; set; }
    public bool IsSuspicious { get; set; }
    public required string ResultHash { get; set; }
    public DateTimeOffset PlayedAt { get; set; }
}

public sealed class AnalyticsEventRecord
{
    public Guid Id { get; set; }
    public Guid? PlayerId { get; set; }
    public required string Name { get; set; }
    public required string PropertiesJson { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}

public sealed class PlayerReportRecord
{
    public Guid Id { get; set; }
    public Guid ReporterPlayerId { get; set; }
    public string? ReportedPlayerId { get; set; }
    public required string ReportedNickname { get; set; }
    public required string Reason { get; set; }
    public string? Details { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class RemoteConfigRecord
{
    public required string Key { get; set; }
    public required string Value { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class AdminAuditRecord
{
    public Guid Id { get; set; }
    public required string AdminId { get; set; }
    public required string Action { get; set; }
    public required string Entity { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public string? IpAddress { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class PaymentPurchaseRecord
{
    public Guid Id { get; set; }
    public required string Provider { get; set; }
    public required string ProviderTransactionId { get; set; }
    public Guid PlayerId { get; set; }
    public required string OfferId { get; set; }
    public required string Currency { get; set; }
    public long AmountMinor { get; set; }
    public long GemsGranted { get; set; }
    public required string Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class SwarmDbContext(DbContextOptions<SwarmDbContext> options) : DbContext(options)
{
    public DbSet<PlayerRecord> Players => Set<PlayerRecord>();
    public DbSet<CurrencyTransactionRecord> CurrencyTransactions => Set<CurrencyTransactionRecord>();
    public DbSet<PlayerCosmeticRecord> PlayerCosmetics => Set<PlayerCosmeticRecord>();
    public DbSet<PlayerProgressRecord> PlayerProgress => Set<PlayerProgressRecord>();
    public DbSet<MatchRecord> Matches => Set<MatchRecord>();
    public DbSet<AnalyticsEventRecord> AnalyticsEvents => Set<AnalyticsEventRecord>();
    public DbSet<PlayerReportRecord> PlayerReports => Set<PlayerReportRecord>();
    public DbSet<RemoteConfigRecord> RemoteConfigs => Set<RemoteConfigRecord>();
    public DbSet<AdminAuditRecord> AdminAuditLogs => Set<AdminAuditRecord>();
    public DbSet<PaymentPurchaseRecord> PaymentPurchases => Set<PaymentPurchaseRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var players = modelBuilder.Entity<PlayerRecord>();
        players.ToTable("players");
        players.HasKey(x => x.Id);
        players.Property(x => x.DeviceIdHash).HasMaxLength(64).IsRequired();
        players.HasIndex(x => x.DeviceIdHash).IsUnique();
        players.Property(x => x.Nickname).HasMaxLength(24).IsRequired();
        players.Property(x => x.Coins).HasDefaultValue(0L);
        players.Property(x => x.Gems).HasDefaultValue(0L);

        var transactions = modelBuilder.Entity<CurrencyTransactionRecord>();
        transactions.ToTable("currency_transactions");
        transactions.HasKey(x => x.Id);
        transactions.Property(x => x.Currency).HasMaxLength(16).IsRequired();
        transactions.Property(x => x.Reason).HasMaxLength(64).IsRequired();
        transactions.Property(x => x.IdempotencyKey).HasMaxLength(128).IsRequired();
        transactions.HasIndex(x => x.IdempotencyKey).IsUnique();
        transactions.HasIndex(x => new { x.PlayerId, x.CreatedAt });
        transactions.HasOne<PlayerRecord>().WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Restrict);

        var cosmetics = modelBuilder.Entity<PlayerCosmeticRecord>();
        cosmetics.ToTable("player_cosmetics");
        cosmetics.HasKey(x => x.Id);
        cosmetics.Property(x => x.ItemId).HasMaxLength(48).IsRequired();
        cosmetics.HasIndex(x => new { x.PlayerId, x.ItemId }).IsUnique();
        cosmetics.HasIndex(x => new { x.PlayerId, x.IsEquipped });
        cosmetics.HasOne<PlayerRecord>().WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Restrict);

        var progress = modelBuilder.Entity<PlayerProgressRecord>();
        progress.ToTable("player_progress");
        progress.HasKey(x => x.PlayerId);
        progress.HasOne<PlayerRecord>().WithOne().HasForeignKey<PlayerProgressRecord>(x => x.PlayerId).OnDelete(DeleteBehavior.Cascade);
        progress.HasIndex(x => x.SeasonXp);
        progress.HasIndex(x => x.BestScore);

        var matches = modelBuilder.Entity<MatchRecord>();
        matches.ToTable("matches"); matches.HasKey(x => x.Id);
        matches.Property(x => x.ResultHash).HasMaxLength(128).IsRequired();
        matches.HasIndex(x => x.ResultHash).IsUnique();
        matches.HasIndex(x => new { x.PlayerId, x.PlayedAt });
        matches.HasIndex(x => new { x.IsSuspicious, x.Score });
        matches.HasOne<PlayerRecord>().WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Restrict);

        var analytics = modelBuilder.Entity<AnalyticsEventRecord>();
        analytics.ToTable("analytics_events"); analytics.HasKey(x => x.Id);
        analytics.Property(x => x.Name).HasMaxLength(64).IsRequired();
        analytics.Property(x => x.PropertiesJson).HasMaxLength(2048).IsRequired();
        analytics.HasIndex(x => new { x.Name, x.OccurredAt });

        var reports = modelBuilder.Entity<PlayerReportRecord>();
        reports.ToTable("player_reports"); reports.HasKey(x => x.Id);
        reports.Property(x => x.ReportedNickname).HasMaxLength(24).IsRequired();
        reports.Property(x => x.Reason).HasMaxLength(32).IsRequired();
        reports.Property(x => x.Details).HasMaxLength(500);
        reports.Property(x => x.Status).HasMaxLength(24).IsRequired();
        reports.HasIndex(x => new { x.Status, x.CreatedAt });

        var config = modelBuilder.Entity<RemoteConfigRecord>();
        config.ToTable("remote_config"); config.HasKey(x => x.Key);
        config.Property(x => x.Key).HasMaxLength(64); config.Property(x => x.Value).HasMaxLength(2048);

        var audit = modelBuilder.Entity<AdminAuditRecord>();
        audit.ToTable("admin_audit_logs"); audit.HasKey(x => x.Id);
        audit.Property(x => x.AdminId).HasMaxLength(64); audit.Property(x => x.Action).HasMaxLength(64); audit.Property(x => x.Entity).HasMaxLength(128);
        audit.HasIndex(x => x.CreatedAt);

        var payments = modelBuilder.Entity<PaymentPurchaseRecord>();
        payments.ToTable("payment_purchases"); payments.HasKey(x => x.Id);
        payments.Property(x => x.Provider).HasMaxLength(24).IsRequired();
        payments.Property(x => x.ProviderTransactionId).HasMaxLength(160).IsRequired();
        payments.Property(x => x.OfferId).HasMaxLength(48).IsRequired();
        payments.Property(x => x.Currency).HasMaxLength(8).IsRequired();
        payments.Property(x => x.Status).HasMaxLength(24).IsRequired();
        payments.HasIndex(x => new { x.Provider, x.ProviderTransactionId }).IsUnique();
        payments.HasIndex(x => new { x.PlayerId, x.CreatedAt });
        payments.HasOne<PlayerRecord>().WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Restrict);
    }
}
