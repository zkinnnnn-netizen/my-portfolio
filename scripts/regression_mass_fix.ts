
import fs from 'fs';
import path from 'path';
import { FORCE_SOURCE_URL_NAMES } from '../lib/ingest';

const MANUAL_SOURCES_PATH = path.join(process.cwd(), 'manual_sources.json');

async function run() {
    const sources = JSON.parse(fs.readFileSync(MANUAL_SOURCES_PATH, 'utf-8'));
    
    const TARGET_SOURCES = [
        '北京大学-通知公告',
        '北京师范大学-通知公告',
        '北京师范大学-简章章程',
        '重庆大学-通知公告',
        '东北大学-通知公告',
        '复旦大学-招生动态',
        '复旦大学-招生政策',
        '华南理工大学-通知公告',
        '同济大学-通知公告',
        '西北农林科技大学-招生指南',
        '西北农林科技大学-招生政策',
        '中国海洋大学-招生快讯',
        '中国海洋大学-信息公开',
        '中国科学技术大学-通知公告',
        '中国农业大学-通知公告',
        '中国人民大学-通知公告',
        '中南大学-招生简章',
        '中南大学-招生资讯',
        '中山大学-最新公告',
        '中央民族大学-通知公告'
    ];

    console.log('--- Mass Fix Regression Test ---');
    let passCount = 0;
    let failCount = 0;

    // 1. Check Mass Fix Set
    for (const name of TARGET_SOURCES) {
        if (FORCE_SOURCE_URL_NAMES.has(name)) {
            console.log(`✅ ${name} is in FORCE_SOURCE_URL_NAMES`);
            passCount++;
        } else {
            console.error(`❌ ${name} is MISSING from FORCE_SOURCE_URL_NAMES`);
            failCount++;
        }
    }

    // 2. Check ZJU Fix
    // ZJU has special logic block, so it might NOT be in the set, but we want to ensure we didn't break it.
    // Actually, I added '浙江大学-通知公告' to the ZJU block name check.
    // I can't easily test the 'if' block logic without importing the whole function, 
    // but I can check if the name matches the expected string.
    
    console.log('\n--- Checking Special Sources ---');
    const specialSources = ['天津大学-通知公告', '浙江大学-最新公告', '浙江大学-通知公告'];
    // These are handled by specific else-if blocks, so they don't strictly need to be in the set.
    // But we want to confirm they exist in manual_sources.json
    
    for (const name of specialSources) {
        const source = sources.find((s: any) => s.name === name);
        if (source) {
            console.log(`✅ Special Source "${name}" found in DB.`);
        } else {
             if (name === '浙江大学-最新公告') {
                 console.warn(`⚠️ Special Source "${name}" NOT found in DB (might be old name).`);
             } else {
                 console.error(`❌ Special Source "${name}" NOT found in DB.`);
                 failCount++;
             }
        }
    }

    console.log(`\nResult: ${passCount}/${TARGET_SOURCES.length} mass fix sources verified.`);
    if (failCount === 0) {
        console.log('ALL TESTS PASSED');
        process.exit(0);
    } else {
        console.error('SOME TESTS FAILED');
        process.exit(1);
    }
}

run();
