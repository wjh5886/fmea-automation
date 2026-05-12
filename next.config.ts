import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
const supabaseUrl = "https://itzgdbeiyvodhfhmvrfw.supabase.co";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['172.20.77.4', '192.168.*', '10.*', '172.*'],
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${backendUrl}/:path*`,
      },
      {
        source: "/sb/:path*",
        destination: `${supabaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
