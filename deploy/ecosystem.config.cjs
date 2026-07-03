// PM2 进程配置：守护 NestJS 后端。
// cwd 指向 server 目录，@nestjs/config 会自动加载该目录下的 .env。
module.exports = {
  apps: [
    {
      name: 'deploy-center-api',
      cwd: '/opt/deploy-center/server',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
