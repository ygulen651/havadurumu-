const express = require('express');
const puppeteer = require(process.env.VERCEL ? 'puppeteer-core' : 'puppeteer');
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
            const chromium = require('@sparticuz/chromium');
            browser = await puppeteer.launch({
                args: [...chromium.args, '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
            });
        }

        const page = await browser.newPage();

        // Stealth Headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://www.mgm.gov.tr/',
            'Origin': 'https://www.mgm.gov.tr'
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`${MGM_URL} adresine gidiliyor...`);
        await page.goto(MGM_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // Verilerin ekrana basılmasını bekle
        console.log('Verilerin yüklenmesi bekleniyor...');
        await page.waitForFunction(() => {
            const temp = document.querySelector('.anlik-sicaklik-deger');
            return temp && temp.innerText.trim() !== '' && temp.innerText.trim() !== '-';
        }, { timeout: 20000 }).catch(e => console.log('Zaman aşımı veya eleman bulunamadı, mevcut durumla devam ediliyor.'));

        // Kısa bir bekleme (Angular'ın scope'u tam doldurması için)
        await new Promise(r => setTimeout(r, 2000));

        console.log('Sayfa içeriği ayrıştırılıyor...');
        const data = await page.evaluate(() => {
            const getAngularData = () => {
                const el = document.querySelector('[ng-controller]');
                const scope = (el && window.angular) ? window.angular.element(el).scope() : null;
                if (!scope) return null;
                return {
                    current: scope.sondurum ? scope.sondurum[0] : null,
                    hourly: scope.tahmin || scope.saatlikTahmin || null,
                    daily: scope.gunlukTahmin || scope.gunluktahmin || null
                };
            };

            const getDomData = () => {
                return {
                    current: {
                        sicaklik: document.querySelector('.anlik-sicaklik-deger')?.innerText?.trim(),
                        nem: document.querySelector('.anlik-nem-deger-kac')?.innerText?.trim(),
                        hadise: document.querySelector('.anlik-durum-hadise')?.innerText?.trim(),
                        istasyon: 'Karaman'
                    },
                    source: 'DOM Fallback'
                };
            };

            const angData = getAngularData();
            return (angData && angData.current) ? { ...angData, method: 'Angular Scope' } : { ...getDomData(), method: 'DOM Fallback' };
        });

        const result = {
            ...data,
            method: data.method || 'Unknown',
            updatedAt: new Date().toISOString()
        };

        weatherCache.data = result;
        weatherCache.lastUpdate = Date.now();

        return result;
    } catch (error) {
        console.error('Puppeteer hatası:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
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
