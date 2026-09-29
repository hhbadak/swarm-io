# SWARM.IO yayın kontrol listesi

## Zorunlu

- [ ] DNS A/AAAA kaydı üretim sunucusuna gidiyor.
- [ ] `POSTGRES_PASSWORD`, `SWARM_TOKEN_SECRET` ve `SWARM_ADMIN_KEY` uzun, rastgele ve birbirinden farklı.
- [ ] `.env` kaynak kontrolüne eklenmedi.
- [ ] `docker compose -f docker-compose.prod.yml config` hata vermiyor.
- [ ] API ve oyun sunucusu sağlık uçları `ready` dönüyor.
- [ ] Masaüstü ve gerçek Android/iOS cihazda arena bağlantısı doğrulandı.
- [ ] Günlük PostgreSQL disk yedeği ve geri yükleme denemesi yapıldı.
- [ ] CPU, bellek, 5xx oranı, WebSocket bağlantıları ve disk doluluk alarmı kuruldu.

## Mağaza ve gelir

- [ ] Kozmetik açıklamalarında güç sağlamadığı açıkça yazıyor.
- [ ] Gerçek ödeme sağlayıcısının şirket hesabı ve vergi ayarları tamamlandı.
- [ ] Webhook imzası doğrulanmadan hiçbir kristal/ürün teslim edilmiyor.
- [ ] Apple/Google mağaza sürümlerinde makbuz doğrulaması sunucuda yapılıyor.
- [ ] İade ve chargeback durumunda muhasebe ters kaydı üretiliyor.
- [ ] KVKK/GDPR gizlilik metni, kullanım şartları ve destek adresi yayında.

## Yayın sonrası

- [ ] İlk 24 saat hata oranı ve ekonomi hacmi yakından izleniyor.
- [ ] Şüpheli maçlar ve oyuncu raporları yönetim panelinde inceleniyor.
- [ ] D1/D7 tutma, maç tamamlama ve mağaza dönüşümü ölçülüyor.
- [ ] Yeni özellikler önce uzaktan ayar bayrağıyla küçük gruba açılıyor.
