import { Router, type IRouter } from "express";
import adminsRouter from "./admins";
import healthRouter from "./health";
import storeRouter from "./store";

const router: IRouter = Router();

router.use(healthRouter);
// Before the store routes: it holds the /admin guard every operator route
// relies on.
router.use(adminsRouter);
router.use(storeRouter);

export default router;
