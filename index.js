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
        await page.goto(MGM_URL, { waitUntil: 'networkidle2' });

        console.log('Sayfa içeriği ayrıştırılıyor...');
        // Angular scope verilerini yakala (Sayfa içindeki global değişkenleri veya DOM'u kullan)
        const data = await page.evaluate(() => {
            const el = document.querySelector('[ng-controller]');
            if (el && window.angular) {
                const scope = window.angular.element(el).scope();
                return {
                    current: scope.sondurum || null,
                    hourly: scope.tahmin || null,
                    daily: scope.gunluktahmin || null,
                };
            }
            // Angular yoksa DOM'dan çekmeyi deneyelim (Fallback)
            return {
                current: {
                    sicaklik: document.querySelector('.anlik-sicaklik-deger')?.innerText,
                    nem: document.querySelector('.anlik-nem-deger')?.innerText,
                    hadise: document.querySelector('.anlik-yuksek-sicaklik-deger')?.innerText
                },
                source: 'DOM Fallback'
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
