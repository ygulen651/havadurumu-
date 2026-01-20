const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// MGM URL
const MGM_URL = 'https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=Karaman';

// Basit Cache Mekanizması
let weatherCache = {
    data: null,
    lastUpdate: null
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 dakika

async function fetchWeatherData() {
    console.log('Puppeteer başlatılıyor...');

    let browser;
    try {
        if (process.env.VERCEL) {
            // Vercel ortamı için yapılandırma
            const chromium = require('@sparticuz/chromium');
            browser = await puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            // Yerel ortam için yapılandırma
            browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const page = await browser.newPage();

        // Tarayıcı gibi görünmek için User-Agent ayarla
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`${MGM_URL} adresine gidiliyor...`);
        await page.goto(MGM_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        // ng-controller elementinin yüklenmesini bekle
        console.log('NG-Controller bekleniyor...');
        await page.waitForSelector('[ng-controller]', { timeout: 10000 }).catch(() => console.log('Selector bulunamadı, devam ediliyor...'));

        // Sayfa tam oturana kadar kısa bir süre bekle
        await new Promise(r => setTimeout(r, 3000));

        console.log('Sayfa içeriği ayrıştırılıyor...');
        const data = await page.evaluate(() => {
            const el = document.querySelector('[ng-controller]');
            const scope = (el && window.angular) ? window.angular.element(el).scope() : null;

            if (scope) {
                return {
                    current: scope.sondurum ? scope.sondurum[0] : null,
                    hourly: scope.tahmin || scope.saatlikTahmin || null,
                    daily: scope.gunlukTahmin || scope.gunluktahmin || null,
                    method: 'Angular Scope'
                };
            }

            // Fallback: DOM
            return {
                current: {
                    sicaklik: document.querySelector('.anlik-sicaklik-deger')?.innerText,
                    nem: document.querySelector('.anlik-nem-deger-kac')?.innerText,
                    hadise: document.querySelector('.anlik-durum-hadise')?.innerText
                },
                method: 'DOM Fallback'
            };
        });

        const result = {
            ...data,
            updatedAt: new Date().toISOString()
        };

        weatherCache.data = result;
        weatherCache.lastUpdate = Date.now();

        return result;
    } catch (error) {
        console.error('Puppeteer hatası:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Root Endpoint (Kullanıcıyı bilgilendirmek için)
app.get('/', (req, res) => {
    res.send(`
        <h1>Karaman Hava Durumu API - Çalışıyor 🚀</h1>
        <p>Verilere erişmek için aşağıdaki uç noktaları kullanabilirsiniz:</p>
        <ul>
            <li><a href="/api/weather">Tüm Veriler (Anlık, Saatlik, Günlük)</a></li>
        </ul>
        <p>MGM verileri her 5 dakikada bir güncellenir.</p>
    `);
});

// Ana Endpoint
app.get('/api/weather', async (req, res) => {
    try {
        const now = Date.now();
        if (weatherCache.data && (now - weatherCache.lastUpdate < CACHE_DURATION)) {
            return res.json(weatherCache.data);
        }

        const data = await fetchWeatherData();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Hava durumu verileri alınamadı.', detail: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor. (Puppeteer Modu)`);
});
