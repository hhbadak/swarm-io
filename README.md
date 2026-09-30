# SWARM.IO

SWARM.IO; web ve mobil tarayıcıda aynı tasarımla çalışan, sunucu otoriteli gerçek zamanlı arena oyunudur. Kurulum gerektirmeden oynanır; PWA olarak telefona eklenebilir.

## Ürün kapsamı

- 20 Hz WebSocket arena; 3200×1800 oyun alanı, arena başına en fazla 50 gerçek oyuncu ve canlı liderlik.
- Hızlı eşleşme ile dolu olmayan genel arenaya giriş; `SW-XXXX` koduyla arkadaş odası oluşturma ve katılma.
- Arena 24 katılımcıya kadar botlarla dolar; gerçek oyuncu geldikçe bir bot otomatik çıkar (3 arkadaş + 21 bot gibi).
- Liderlik tablosunda gerçek oyuncu ve botlar ayrı işaretlenir.
- Dairesel ve yumuşak büyüme; biraz büyük olan oyuncu küçüğü yiyebilir.
- Dört enerji nadirliği, hız/altın/çekim bölgeleri ve enerji fırtınası.
- Atılma, kalkan ve mıknatıs yetenekleri; sunucu tarafında bekleme süresi denetimi.
- 15 saniyelik bağlantı kopma toleransı ve aynı maça dönüş.
- Misafir hesap, kalıcı profil, envanter, kozmetik mağaza ve kuşanma.
- Günlük ödül serisi, görevler, seviye, sezon yolu, dünya liderliği ve maç geçmişi.
- Raporlama, analitik olayları, uzaktan ayarlar ve yönetim paneli.
- Masaüstü/mobil responsive arayüz, PWA manifesti ve güvenli statik önbellek.
- PostgreSQL + Redis sağlık denetimi, otomatik HTTPS ve yeniden başlatmalı üretim paketi.

Kozmetikler yalnızca görünümü değiştirir; hız, yeme gücü veya çarpışma alanı satılmaz.

## Yerelde çalıştırma

.NET 8 hedefini destekleyen .NET 10 SDK gereklidir. Yerel profil SQLite kullanır; Docker gerekmez.

```powershell
dotnet run --project src/Swarm.GameServer --urls http://localhost:5090
```

İkinci terminalde:

```powershell
dotnet run --project src/Swarm.Api --urls http://localhost:5080
```

Ardından `http://localhost:5080` açılır. Yerel yönetim paneli `http://localhost:5080/admin.html`; varsayılan yalnızca-yerel anahtar `swarm-local-admin` değeridir.

## Test

```powershell
dotnet build Swarm.IO.slnx
dotnet run --project tests/Swarm.Tests/Swarm.Tests.csproj
```

Sağlık uçları:

- API: `GET http://localhost:5080/health/ready`
- Oyun sunucusu: `GET http://localhost:5090/health/ready`

## 7/24 üretim yayını

1. `.env.example` dosyasını `.env` olarak kopyala; güçlü ve farklı veritabanı, token ve yönetici sırları gir.
2. `SWARM_DOMAIN` değerini oyunun DNS kaydına yaz ve sunucunun 80/443 portlarını aç.
3. `docker compose -f docker-compose.prod.yml up -d --build` komutunu çalıştır.

Paket internete yalnızca Caddy üzerinden 80/443 açar. Caddy TLS sertifikasını otomatik yeniler; API, oyun sunucusu, PostgreSQL ve Redis dışarıya port açmadan özel ağda kalır. Tüm servislerde sağlık kontrolü ve `unless-stopped` yeniden başlatma ilkesi vardır. Veriler adlandırılmış disklerde kalıcıdır.

Dağıtımdan önce [yayın kontrol listesini](docs/release-checklist.md) uygula.

## Güvenlik

- Cihaz kimlikleri SHA-256 ile özetlenir; ham kimlik saklanmaz.
- Erişim, maç ve sonuç biletleri amaç-kısıtlı HMAC-SHA256 imzalıdır.
- Hareket, büyüme, yetenek, çarpışma, skor ve ödül hesabı sunucudadır.
- Ödül işlemleri tekrar gönderime dayanıklı benzersiz muhasebe kayıtları kullanır.
- Yazma ve giriş uçları hız sınırlıdır; güvenlik başlıkları varsayılan açıktır.
- Yönetici anahtarı sabit-zamanlı karşılaştırılır ve üretimde yalnızca ortam sırrından gelir.

Gerçek para tahsilatı varsayılan olarak kapalıdır. Canlı ödeme sağlayıcısı ve mağaza hesapları bağlanmadan istemciye sahte başarı/ödül verilmez.

Mobil istemci varsayılan olarak `https://swarm-io.onrender.com` canlı API adresine bağlanır. Otomatik cihaz-içi moda düşmez; bağlantı sorunu görünür biçimde bildirilir. Yerel çevrimdışı simülasyon yalnızca geliştirme amacıyla `?offline=1` parametresiyle açılır.

## Yapı

- `src/Swarm.Api`: kimlik, ekonomi, meta oyun, yönetim ve web istemcisi.
- `src/Swarm.GameServer`: gerçek zamanlı arena ve WebSocket taşıması.
- `src/Swarm.Application`: deterministik simülasyon ve imzalı tokenlar.
- `src/Swarm.Domain`: ortak oyun modelleri.
- `src/Swarm.Infrastructure`: kalıcı veri ve muhasebe şeması.
- `apps/web`: ortak web/mobil/PWA istemcisi.
- `tests/Swarm.Tests`: güvenlik ve oyun motoru regresyon testleri.
- Kök HTML dosyaları: Firevibe tasarım referansları; değiştirilmeden korunur.
