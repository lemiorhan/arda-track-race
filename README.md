# Trucks on Road

**by Arda & Kuzey Brothers**

İki tır, tek yol. Rakibinden önce yolu bitir, dorseyi geri geri park et, kutuları doğru diz.

Trucks on Road, iki kişilik bir tır yarışı oyunudur. Aynı klavyede yan yana oynayabilir, ya da iki ayrı bilgisayardan online maç yapabilirsiniz. Oyun tarayıcıda çalışır. Kurulum gerekmez.

## Hemen oyna

👉 **https://lemiorhan.github.io/trucks-on-road-online-game**

Bilgisayarda Chrome, Edge, Firefox ya da Safari ile açın. Oyun klavyeyle oynanır, telefon ve tablette çalışmaz.

## Oyun nasıl oynanır?

Her maç bir ya da birkaç turdan oluşur. Her tur üç aşamalıdır.

1. **Yarış.** Yolda yavaş araçlar ve karşıdan gelen trafik var. Sollamak için karşı şeride geçebilirsin ama kafa kafaya çarpma. Kaza tırı birkaç saniye durdurur.
2. **Park.** Park alanında kendi rengindeki bölmeye dorseyi geri geri yanaştır. Dorse düz durmalı ve rampaya dayanmalı.
3. **Boşaltma.** İşçiyle kutuları dorseden alıp hedef alana taşı. Ekrandaki **Hedef Dizilim** paneli hangi kutunun nereye gideceğini gösterir.

Kutuları ilk doğru dizen turu kazanır. Maçın sonunda toplam puanı yüksek olan şampiyon olur.

### Rotalar

| Rota | Zorluk | Özelliği |
|---|---|---|
| Sahil Yolu | 3 / 5 | Yoğun trafik |
| Ova Yolu | 3 / 5 | Kalabalık |
| Çöl Yolu | 4 / 5 | Hızlı karşı trafik |
| Karlı Geçit | 5 / 5 | Buzlu yol |
| Dağ Geçidi | 5 / 5 | Keskin virajlar |

Her oyuncu kendi rotasını seçer.

### Yolda seni neler bekliyor?

- **Köprü, toprak yol, tünel.** Köprüde kenar payı yoktur. Toprak yolda tır kayar. Tünel karanlıktır.
- **Kavşak ve döner kavşak.** Kırmızı ışıkta geçmek ceza yazar. Döner kavşakta dış şeritten dön.
- **Radar ve gişe.** Tabeladaki hızın üstünde geçersen ceza yazılır.
- **Koyun sürüsü ve yol çalışması.** Tabelayı görünce yavaşla.
- **Rüzgâr tüneli.** Rakibin hemen arkasında kalırsan hızın artar.
- **Turbo.** Her turda yarışın bir yerinde birkaç saniyelik turbo kendiliğinden açılır.

Bütün kurallar ve puanlama oyunun içindeki **Nasıl Oynanır** ekranında yazıyor.

## Tuşlar

| Ne yapar | Oyuncu 1 · Mavi | Oyuncu 2 · Kırmızı |
|---|---|---|
| Gaz / ileri yürü | `W` | `↑` |
| Fren, geri vites / geri yürü | `S` | `↓` |
| Direksiyon / yana yürü | `A` `D` | `←` `→` |
| Motor freni | `Space` | `Sağ Option` / `Alt Gr` |
| Korna | `E` | `Enter` |
| Kutu al / bırak | `Space` veya `E` | `Enter` |
| Kurtarma (yola dön) | `Q` | `Sağ Shift` |
| Duraklat | `Esc` veya `P` | |
| Tam ekran | `F` | |

Açılış introsunu `Enter`, `Esc`, `Space` ya da **Skip intro** butonuyla geçebilirsin.

## Online maç

İki ayrı bilgisayarda oynamak için:

1. İki oyuncu da oyunu açar ve **Online Maç**'a girer.
2. Biri **Oda kur**'a basar. Ekranda beş harfli bir oda kodu çıkar.
3. Öbürü bu kodu yazıp **Odaya katıl**'a basar.

Odayı kuran Mavi, katılan Kırmızı tırı sürer. İkiniz de `W` `A` `S` `D` ya da ok tuşlarını kullanabilirsiniz. Bağlantı [PeerJS](https://peerjs.com/) ile kurulur, bu yüzden internet bağlantısı gerekir.

## Kendi bilgisayarında çalıştır

Oyun düz HTML, CSS ve JavaScript'ten oluşur. Build adımı yoktur.

```sh
git clone https://github.com/lemiorhan/truck-race.git
cd truck-race
python3 -m http.server 8000
```

Sonra tarayıcıda `http://localhost:8000` adresini aç. Herhangi bir statik dosya sunucusu da iş görür.

### Testler

Testler için [Node.js](https://nodejs.org/) 22 ya da üstü gerekir.

```sh
npm install
npx playwright install chromium
npm test              # unit testler
npm run test:e2e      # iki sekmede uçtan uca online maç
npm run test:peer     # iki tarayıcı arasında gerçek PeerJS bağlantısı (internet ister)
```

## Katkı

Hata bulduysan ya da bir fikrin varsa [issue aç](https://github.com/lemiorhan/truck-race/issues). Kod göndermek istersen önce [CONTRIBUTING.md](CONTRIBUTING.md)'yi oku. Topluluk kuralları [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)'de.

## Lisans

Trucks on Road, [Apache License 2.0](LICENSE) ile lisanslanmıştır. Kullanılan üçüncü taraf yazılımlar [NOTICE](NOTICE) dosyasında yazıyor.
