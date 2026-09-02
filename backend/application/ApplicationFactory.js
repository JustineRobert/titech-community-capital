function createApp(context) {

    const app = express();

    attachMetadata(app, context);

    attachApplicationContext(app, context);

    registerMiddleware(app, context);

    registerRoutes(app, context);

    registerHealthEndpoints(app, context);

    registerErrorPipeline(app);

    return app;

}