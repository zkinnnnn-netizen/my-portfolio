
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

async function main() {
    const disabledSources = await prisma.source.findMany({
        where: { isActive: false },
        select: {
            name: true,
            url: true,
            lastError: true,
            crawlConfig: true
        }
    });

    const recoverable: any[] = [];
    const needBrowser: any[] = [];
    const highWaf: any[] = [];
    const others: any[] = [];

    for (const s of disabledSources) {
        const err = s.lastError || '';
        let config: any = {};
        try { config = JSON.parse(s.crawlConfig || '{}'); } catch(e){}
        const transport = config.transport || 'default';

        const item = {
            name: s.name,
            url: s.url,
            lastError: err.replace(/\n/g, ' ').substring(0, 60) + (err.length > 60 ? '...' : ''),
            transport
        };

        const errUpper = err.toUpperCase();

        if (errUpper.includes('TLSORWAFBLOCKED') || errUpper.includes('UNDICI') || errUpper.includes('SOCKETERROR') || errUpper.includes('FETCH FAILED') || errUpper.includes('ECONNRESET')) {
            recoverable.push(item);
        } else if (errUpper.includes('DYNAMICSITE') || errUpper.includes('JS_RENDER') || (errUpper.includes('TIMEOUT') && !errUpper.includes('403'))) {
            needBrowser.push(item);
        } else if (errUpper.includes('WAFBLOCKED') || errUpper.includes('412') || errUpper.includes('JS_CHALLENGE') || errUpper.includes('403') || errUpper.includes('ETIMEDOUT')) {
            // ETIMEDOUT often WAF dropping packets
            highWaf.push(item);
        } else {
            others.push(item);
        }
    }

    console.log('=== Disabled Sources Triage ===');
    
    console.log(`\n1. 可救活 (TLS/Socket/Undici/Conn) [${recoverable.length}]:`);
    recoverable.forEach(s => console.log(` - ${s.name} [${s.transport}]: ${s.lastError}`));

    console.log(`\n2. 需浏览器 (Dynamic/JS) [${needBrowser.length}]:`);
    needBrowser.forEach(s => console.log(` - ${s.name} [${s.transport}]: ${s.lastError}`));

    console.log(`\n3. 高对抗WAF (403/412/Challenge) [${highWaf.length}]:`);
    highWaf.forEach(s => console.log(` - ${s.name} [${s.transport}]: ${s.lastError}`));
    
    if (others.length > 0) {
        console.log(`\n4. 其他原因 [${others.length}]:`);
        others.forEach(s => console.log(` - ${s.name} [${s.transport}]: ${s.lastError}`));
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
