import type { NextConfig } from 'next';
import path from 'path';
import os from 'os';

// Determine allowed development origins (local network IPs on port 3000)
const interfaces = os.networkInterfaces();
const allowedOrigins: string[] = ['http://localhost:3000', 'http://192.168.0.94:3000'];
Object.values(interfaces).forEach((list) =>
    list?.forEach((iface) => {
        if (iface.family === 'IPv4' && !iface.internal) {
            allowedOrigins.push(`http://${iface.address}:3000`);
        }
    })
);
const nextConfig: NextConfig = {
    reactStrictMode: true,
    // Allow static asset requests from these origins in dev mode
    allowedDevOrigins: allowedOrigins,
    async rewrites() {
        const apiPort = process.env.API_PORT ?? '3001';
        return [
            {
                source: '/api/:path*',
                destination: `http://localhost:${apiPort}/api/:path*`, // Proxy to backend
            },
        ];
    },
    // Allow cross-origin requests for Next.js static and HMR assets during dev
    async headers() {
        return [
            {
                source: '/_next/:path*',
                headers: [
                    { key: 'Access-Control-Allow-Origin', value: '*' },
                    {
                        key: 'Access-Control-Allow-Methods',
                        value: 'GET, POST, PUT, DELETE, OPTIONS',
                    },
                    {
                        key: 'Access-Control-Allow-Headers',
                        value: 'X-Requested-With, Content-Type, Accept',
                    },
                ],
            },
            {
                source: '/api/:path*',
                headers: [
                    { key: 'Access-Control-Allow-Origin', value: '*' },
                    {
                        key: 'Access-Control-Allow-Methods',
                        value: 'GET, POST, PUT, DELETE, OPTIONS',
                    },
                    {
                        key: 'Access-Control-Allow-Headers',
                        value: 'X-Requested-With, Content-Type, Accept',
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
