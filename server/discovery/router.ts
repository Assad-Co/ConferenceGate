import { requireAuth } from "../auth";
import { organizationDirectoryRouter } from "./organizationDirectory";
import { discoveryRouter } from "./legacyRouter";

// Phase 44 adds a signed-in organization reputation directory while leaving the established
// discovery/admin engine unchanged. The legacy router continues to own all existing routes.
discoveryRouter.use("/organizations", requireAuth, organizationDirectoryRouter);

export { discoveryRouter };
