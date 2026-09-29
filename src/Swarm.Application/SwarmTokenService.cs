using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Swarm.Application;

public sealed record SwarmTokenPayload(Guid PlayerId, string Nickname, string Purpose, long ExpiresAtUnix);

public sealed class SwarmTokenService
{
    private readonly byte[] _secret;
    public SwarmTokenService(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32) throw new ArgumentException("Token secret must contain at least 32 characters.", nameof(secret));
        _secret = Encoding.UTF8.GetBytes(secret);
    }

    public string Issue(Guid playerId, string nickname, string purpose, TimeSpan lifetime)
    {
        var payload = new SwarmTokenPayload(playerId, nickname, purpose, DateTimeOffset.UtcNow.Add(lifetime).ToUnixTimeSeconds());
        var data = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(payload));
        return $"{data}.{Sign(data)}";
    }

    public bool TryValidate(string token, string expectedPurpose, out SwarmTokenPayload payload)
        => TryValidateCore(token, purpose => purpose == expectedPurpose, out payload);

    public bool TryValidatePurposePrefix(string token, string purposePrefix, out SwarmTokenPayload payload)
        => TryValidateCore(token, purpose => purpose.StartsWith(purposePrefix, StringComparison.Ordinal), out payload);

    private bool TryValidateCore(string token, Func<string, bool> purposeValidator, out SwarmTokenPayload payload)
    {
        payload = default!;
        var parts = token.Split('.', 2);
        if (parts.Length != 2) return false;
        var expected = Encoding.ASCII.GetBytes(Sign(parts[0]));
        var actual = Encoding.ASCII.GetBytes(parts[1]);
        if (expected.Length != actual.Length || !CryptographicOperations.FixedTimeEquals(expected, actual)) return false;
        try
        {
            var parsed = JsonSerializer.Deserialize<SwarmTokenPayload>(Base64UrlDecode(parts[0]));
            if (parsed is null || !purposeValidator(parsed.Purpose) || parsed.ExpiresAtUnix <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return false;
            payload = parsed;
            return true;
        }
        catch (JsonException) { return false; }
        catch (FormatException) { return false; }
    }

    private string Sign(string data)
    {
        using var hmac = new HMACSHA256(_secret);
        return Base64UrlEncode(hmac.ComputeHash(Encoding.ASCII.GetBytes(data)));
    }
    private static string Base64UrlEncode(byte[] data) => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] Base64UrlDecode(string data)
    {
        var padded = data.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + ((4 - padded.Length % 4) % 4), '=');
        return Convert.FromBase64String(padded);
    }
}
