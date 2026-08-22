# Kriter Atölyesi — paylaşım ve çalıştırma

Bu paket kaynak kodu, sentetik örnek belgeyi ve üç resmî TEKNOFEST test şartnamesini içerir. Güvenlik nedeniyle gerçek Gemini API anahtarı pakete eklenmemiştir.

## Başlatma

1. Bilgisayarda Node.js 20 veya daha yeni bir sürüm bulunmalıdır.
2. Bu klasörde bir terminal açın.
3. `npm install` komutunu çalıştırın.
4. `.env.example` dosyasını `.env.local` adıyla kopyalayın.
5. `.env.local` içindeki `your_api_key_here` değerini kendi Gemini API anahtarınızla değiştirin.
6. `npm run dev` komutunu çalıştırın.
7. Tarayıcıdan `http://localhost:3000/` adresini açın.

## Pakete özellikle eklenmeyenler

- Gerçek API anahtarı ve `.env.local`
- `node_modules`
- Geçici derleme ve test klasörleri

Bu dosyalar paylaşım paketinin gereksiz büyümesini veya gizli bilginin açığa çıkmasını önlemek için dışarıda bırakılmıştır.
