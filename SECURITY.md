# Güvenlik

## Güvenlik açığı bildirmek

Bir güvenlik açığı bulduysan lütfen herkese açık bir issue açma. Bunun yerine GitHub'ın gizli bildirim özelliğini kullan:

1. Repo'nun **Security** sekmesine git.
2. **Report a vulnerability**'ye bas.
3. Açığı, nasıl tekrarlanacağını ve etkisini yaz.

Bildirimine en kısa sürede dönmeye çalışırız.

## Kapsam

Oyun tarayıcıda çalışır ve sunucusu yoktur. Online maçta iki oyuncu [PeerJS](https://peerjs.com/) ile doğrudan bağlanır. Özellikle şu konulardaki bildirimler işimize yarar:

- Online maçta karşı taraftan gelen verinin sayfada kod çalıştırması.
- Oyuncu adları gibi kullanıcı girdilerinin sayfayı bozması.

## Desteklenen version

Sadece `master` branch'indeki ve [yayındaki](https://lemiorhan.github.io/truck-race/) son version desteklenir.
