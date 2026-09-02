const config = getConfiguration();

app.locals.context = context;

app.locals.services = serviceRegistry;

app.locals.config = configurationProvider;


req.app.locals.context