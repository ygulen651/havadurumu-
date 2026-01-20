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
    let weatherData = {
        current: null,
        hourly: null,
        daily: null
    };

    try {
        if (process.env.VERCEL) {
            const chromium = require('@sparticuz/chromium');
            browser = await puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Network dinleyici ekle
        page.on('response', async (response) => {
            const url = response.url();
            try {
                if (url.includes('servis.mgm.gov.tr')) {
                    const data = await response.json();
                    if (url.includes('sondurumlar')) weatherData.current = data[0] || data;
                    if (url.includes('saatlik')) weatherData.hourly = data[0] || data;
                    if (url.includes('gunluk')) weatherData.daily = data[0] || data;
                }
            } catch (e) {
                // JSON parse hatası veya boş body olabilir, yoksay
            }
        });

        console.log(`${MGM_URL} adresine gidiliyor...`);
        // Vercel 10sn limiti için domcontentloaded daha hızlıdır
        await page.goto(MGM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Verilerin gelmesi için kısa bir süre bekle (MGM API'leri hızlıdır)
        console.log('Verilerin yakalanması bekleniyor...');
        let attempts = 0;
        while (attempts < 10) { // Maksimum 5 saniye bekle (500ms * 10)
            if (weatherData.current && weatherData.hourly && weatherData.daily) break;
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        const result = {
            ...weatherData,
            method: weatherData.current ? 'Network Interception' : 'Failed',
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
