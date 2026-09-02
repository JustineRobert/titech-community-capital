registry.register({

    id: "helmet",

    order: 60,

    middleware: helmet(),

    dependencies: [
        "trust-proxy"
    ]

});