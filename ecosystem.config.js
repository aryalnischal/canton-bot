module.exports = {
    apps: [
        {
            name: "canton-bot",
            script: "server.js",        // Directly run the standalone server
            instances: "max",           // Scale across all available CPU cores
            exec_mode: "cluster",       // Use cluster mode for better performance
            env: {
                NODE_ENV: "production",
                PORT: 3000
            }
        }
    ]
}
