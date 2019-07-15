var unirest = require('unirest');

const TRANSLOC_KEY = "get ur own";

const AGENCY = 1323;

// a circle of 1,000 meters around (40.505, -74.445)
const GEO_AREA = encodeURIComponent("40.505,-74.445|4000");

/** Little note before we begin: this would be a lot simpler if the "is_active" field
 * from routes.json actually worked. But it doesn't, at least with Rutgers. So the
 * first endpoint we hit is actually arrival-estimates.json, which we use to figure
 * out which routes are active from whether they have arrival estimates.
 *
 * The problem with this is there's no way to know if a route is running but just
 * doesn't have any arrival estimates. So when there aren't any arrival estimates for
 * a route, it just isn't shown to the user at all.
 */

// First we look at the arrival estimates to figure out which routes are actually active
unirest.get(`https://transloc-api-1-2.p.rapidapi.com/arrival-estimates.json?agencies=${AGENCY}&geo_area=${GEO_AREA}`)
    .header("X-RapidAPI-Host", "transloc-api-1-2.p.rapidapi.com")
    .header("X-RapidAPI-Key", TRANSLOC_KEY)
    .end(result => {
        const arrivalEstimates = result.body.data;

        let returnMeRoutes = arrivalEstimates
            // flat map to a list of arrival estimate objects
            .flatMap(predictionListBundle => predictionListBundle.arrivals)
            // map each of those objects to the route ID the object says it's for
            .map(arrivalBundle => arrivalBundle.route_id)
            // filter out duplicate route IDs
            .filter((routeId, index, array) => index === array.indexOf(routeId))
            // map each route ID to an object. Later we'll also add the route's name, color, and stop predictions.
            .map(routeId => ({routeId: routeId}));

        unirest.get(`https://transloc-api-1-2.p.rapidapi.com/routes.json?agencies=${AGENCY}&geo_area=${GEO_AREA}`)
            .header("X-RapidAPI-Host", "transloc-api-1-2.p.rapidapi.com")
            .header("X-RapidAPI-Key", TRANSLOC_KEY)
            .end(result => {
                const rutgersRoutes = result.body.data[AGENCY];

                // For each route, add the route's name, color, and associated stop IDs.
                returnMeRoutes.forEach(activeRoute => {
                    const thisRouteInfo = rutgersRoutes.filter(rutgersRoute => rutgersRoute.route_id === activeRoute.routeId)[0];
                    if (thisRouteInfo !== undefined) {
                        activeRoute.routeName = thisRouteInfo.long_name;
                        activeRoute.routeColor = thisRouteInfo.color;
                        activeRoute.stops = thisRouteInfo.stops.map(stop => ({stopId: stop}))
                    }
                });

                // Next we'll remove the routes that...don't have names? That's why we needed that
                // "thisRouteInfo !== undefined" check above - there are apparently predictions for
                // routes that...don't exist? Idk, but ok.
                returnMeRoutes = returnMeRoutes.filter(route => route.routeName !== undefined);

                // Next we'll add the predictions to our data
                returnMeRoutes.forEach(returningRoute => {
                    let returningRouteId = returningRoute.routeId;
                    returningRoute.stops.forEach(returningStop => {
                        let returningStopId = returningStop.stopId;
                        returningStop.arrivalEstimates = arrivalEstimates
                            // Make sure stop ID matches
                            .filter(predictionListBundle => predictionListBundle.stop_id === returningStopId)
                            // Flat map so we have a list of arrival bundles
                            .flatMap(predictionListBundle => predictionListBundle.arrivals)
                            // Make sure route ID matches
                            .filter(arrivalBundle => arrivalBundle.route_id === returningRouteId)
                            // Map each bundle to the arrival estimate it contains
                            .map(arrivalBundle => arrivalBundle.arrival_at);
                    });
                });

                // Finally, we'll get the names of all the stops
                unirest.get(`https://transloc-api-1-2.p.rapidapi.com/stops.json?agencies=${AGENCY}&geo_area=${GEO_AREA}`)
                    .header("X-RapidAPI-Host", "transloc-api-1-2.p.rapidapi.com")
                    .header("X-RapidAPI-Key", TRANSLOC_KEY)
                    .end(result => {
                        const rutgersStops = result.body.data;

                        returnMeRoutes.forEach(route => {
                            route.stops.forEach(stop => {
                                stop.stopName = rutgersStops
                                    .filter(rutgersStop => rutgersStop.stop_id === stop.stopId)
                                    [0].name;
                            })
                        });

                        // Done!
                    });
            });
    });
