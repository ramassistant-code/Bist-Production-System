import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/require-auth";
import funnelsRouter from "./funnels";
import adsRouter from "./ads";
import leadsRouter from "./leads";
import statusesRouter from "./statuses";
import activityRouter from "./activity";
import availabilityRouter from "./availability";
import webhooksRouter from "./webhooks";

const crmRouter: IRouter = Router();

// ⚠️ הסדר כאן הוא מנגנון האבטחה, לא סגנון.
//
// webhooksRouter מכיל את הנתיבים שמאומתים בסוד משותף ולא במשתמש:
// /webhooks/lead ו-/jobs/*. הוא חייב להישאר לפני requireAuth, אחרת מטא
// ו-n8n יקבלו 401 — ובמקרה של מטא, ליד שנדחה נעלם אחרי כמה נסיונות.
//
// ובכיוון ההפוך: כל ראוטר שיתווסף מעל השורה של requireAuth ייחשף בלי
// אימות משתמש. ראוטר חדש נכנס מתחתיה, תמיד.
//
// נתיב שאינו תואם דבר ב-webhooksRouter ממשיך הלאה ונופל ל-requireAuth,
// שמחזיר {"error":"לא מורשה"} — שונה מהודעת הסוד. אם קריאה לג'וב מחזירה
// את ההודעה הזו, הנתיב לא קיים בגרסה שרצה, כלומר הפריסה מיושנת.
crmRouter.use(webhooksRouter);
crmRouter.use(requireAuth);
crmRouter.use(availabilityRouter);
crmRouter.use(funnelsRouter);
crmRouter.use(adsRouter);
crmRouter.use(statusesRouter);
crmRouter.use(activityRouter);
crmRouter.use(leadsRouter);

export default crmRouter;