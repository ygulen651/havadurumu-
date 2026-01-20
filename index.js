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

        console.log(`${MGM_URL} adresine gidiliyor...`);
        // domcontentloaded hızı artırır, sadece sayfa iskeletinin olması fetch için yeterlidir.
        await page.goto(MGM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log('API verileri çekiliyor...');
        const weatherData = await page.evaluate(async () => {
            const fetchJson = (url) => fetch(url).then(r => r.json()).catch(() => null);

            // Karaman-Merkez için doğru ID'ler: merkezid: 97001, istno: 17246
            const [current, hourly, daily] = await Promise.all([
                fetchJson('https://servis.mgm.gov.tr/web/sondurumlar?merkezid=97001'),
                fetchJson('https://servis.mgm.gov.tr/web/tahminler/saatlik?istno=17246'),
                fetchJson('https://servis.mgm.gov.tr/web/tahminler/gunluk?istno=97001')
            ]);

            return {
                current: current ? (current[0] || current) : null,
                hourly: hourly ? (hourly[0] || hourly) : null,
                daily: daily ? (daily[0] || daily) : null
            };
        });

        const result = {
            ...weatherData,
            method: weatherData.current ? 'Direct Page-Context Fetch' : 'Failed',
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
