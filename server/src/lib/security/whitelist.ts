import { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import dotenv from "dotenv";

dotenv.config();

const whitelistedHostnames = [
    /^(.+\.)?wintrchess\.com$/,
    /localhost/,
    /127\.0\.0\.1/,
    /0\.0\.0\.0/,
    /host\.docker\.internal/,
    ...(process.env.ORIGIN
        ? [new RegExp(new URL(process.env.ORIGIN).hostname)] : []
    )
];

const hostnameWhitelist: RequestHandler = (req, res, next) => {
    if (process.env.DISABLE_HOSTNAME_CHECK === "true" || process.env.NODE_ENV === "development") {
        return next();
    }

    const hostWhitelisted = whitelistedHostnames.some(
        hostnameRegex => hostnameRegex.test(req.hostname)
    );

    if (!hostWhitelisted) {
        return res.sendStatus(StatusCodes.UNAUTHORIZED);
    }

    next();
};

export default hostnameWhitelist;