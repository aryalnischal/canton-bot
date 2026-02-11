module.exports = {
    apps: [
        {
            name: "nextjs-app",
            script: "npm",
            args: "start",
            instances: 1,
            exec_mode: "fork", // use cluster only if NOT using next start (custom server needed)
            env: {
                NODE_ENV: "production",
                PORT: 3000
            }
        }
    ]
}
