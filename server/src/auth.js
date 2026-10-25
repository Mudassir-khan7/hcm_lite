import jwt from "jsonwebtoken";
import { Employee, User } from "./models.js";

export async function authenticate(req, res, next) {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(claims.sub)
      .select("email role employee active firstName lastName forcePasswordChange");
    if (!user?.active) return res.status(401).json({ error: "Account is unavailable." });
    req.user = user;
    if (
      user.forcePasswordChange &&
      req.path !== "/api/auth/me" &&
      req.path !== "/api/auth/change-password"
    ) {
      return res.status(403).json({ error: "Change your temporary password before continuing." });
    }
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    return next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    return next();
  };
}

export async function employeeScope(user) {
  if (user.role === "admin" || user.role === "hr") return {};
  if (!user.employee) return { _id: null };
  if (user.role === "employee") return { _id: user.employee };

  const reportIds = await Employee.find({ manager: user.employee }).distinct("_id");
  return { _id: { $in: [user.employee, ...reportIds] } };
}

export async function scopedEmployeeIds(user) {
  const scope = await employeeScope(user);
  if (scope._id === null) return [];
  if (scope._id?.$in) return scope._id.$in;
  if (scope._id) return [scope._id];
  return null;
}
