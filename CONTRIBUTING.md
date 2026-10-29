# Katkı rehberi

Trucks on Road'a katkı vermek istediğin için teşekkürler. Bu döküman nasıl katkı verebileceğini anlatır.

## Hata bildirmek

[Issue aç](https://github.com/lemiorhan/truck-race/issues/new/choose) ve **Hata bildirimi** şablonunu seç. Şunları yaz:

- Ne yaptın?
- Ne olmasını bekliyordun?
- Ne oldu?
- Hangi tarayıcıyı ve işletim sistemini kullanıyorsun?

Ekran görüntüsü ya da kısa bir video çok yardımcı olur. Tarayıcının console'unda kırmızı bir hata varsa onu da ekle.

## Fikir önermek

Yeni bir rota, yol olayı ya da oyun modu mu düşündün? **Fikir önerisi** şablonuyla issue aç. Kod yazmadan önce fikri issue'da konuşmak, boşa emek harcamanı önler.

## Kod göndermek

1. Repo'yu fork'la ve yeni bir branch aç.
2. Değişikliğini yap. Oyunu tarayıcıda açıp elle de dene.
3. Testleri çalıştır:

   ```sh
   npm install
   npx playwright install chromium
   npm test
   npm run test:e2e
   ```

4. Pull request aç. Ne değiştirdiğini ve neden değiştirdiğini kısaca yaz.

### Kod yazarken

- Oyun düz JavaScript ile yazıldı. Framework ve build adımı yok, öyle kalsın.
- Her dosya `window.TR` altında bir modül tanımlar. Yeni dosya eklersen `index.html`'deki script sırasına ekle.
- Oyundaki bütün yazılar Türkçe.
- Comment'i sadece kodun kendisinin anlatamadığı "neden"i yazmak için kullan.
- Commit mesajları İngilizce ve emir kipinde: `Add a toll gate to the desert route`.

## Lisans

Gönderdiğin katkı, projenin [Apache License 2.0](LICENSE) lisansı altında yayımlanır.
