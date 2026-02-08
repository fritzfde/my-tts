#!/usr/bin/env node

// Simple script to find your local IP address for OBS overlays

const os = require('os');

console.log('\n🌐 Finding your local IP addresses...\n');

const interfaces = os.networkInterfaces();
let found = false;

for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`✅ ${name}: ${iface.address}`);
            console.log(`   Use in OBS: http://${iface.address}:3000/overlay/gifts`);
            console.log(`   Or:         http://${iface.address}:3000/overlay/likers\n`);
            found = true;
        }
    }
}

if (!found) {
    console.log('❌ No local network interface found.');
    console.log('💡 If running on localhost only, use: http://localhost:3000/overlay/gifts\n');
} else {
    console.log('📝 Copy one of the URLs above into OBS Browser Source.');
    console.log('   Make sure your firewall allows connections on port 3000.\n');
}