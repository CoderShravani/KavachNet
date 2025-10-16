const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

admin.initializeApp();
const db = admin.firestore();
const app = express();
// Using a more permissive CORS policy to prevent fetch errors during local development.
// This allows the server to dynamically accept requests from the client's origin.
app.use(cors({ origin: true }));
app.use(express.json());

// --- AUTH MIDDLEWARE ---

// Middleware to verify Firebase ID Token
const verifyToken = async (req, res, next) => {
  const idToken = req.headers.authorization?.split("Bearer ")[1];
  if (!idToken) {
    return res.status(403).send("Unauthorized");
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying token:", error);
    return res.status(403).send("Unauthorized");
  }
};

// Middleware to check for Admin role
const isAdmin = async (req, res, next) => {
    // Check for custom claim `role`
    if (req.user.role !== 'admin') {
        return res.status(403).send("Forbidden: Requires admin privileges.");
    }
    next();
};


// --- AUTH ROUTES ---

// Set a custom role on a user (callable only by an admin)
app.post("/setRole", verifyToken, isAdmin, async (req, res) => {
    const { uid, role } = req.body; // role can be 'admin' or null to revoke
    if (!uid) {
        return res.status(400).send("Missing uid in request body.");
    }
    // Hardening: only allow setting/revoking the 'admin' role via this function
    if (role !== 'admin' && role !== null) {
        return res.status(400).send("Invalid role specified. Only 'admin' role can be managed.");
    }
    try {
        await admin.auth().setCustomUserClaims(uid, { role });
        // Optionally update role in Firestore document for easier querying
        await db.collection('partners').doc(uid).update({ role }).catch(() => {});
        return res.status(200).send({ message: `Success! User ${uid}'s admin role has been updated.` });
    } catch (error) {
        console.error("Error setting custom claims:", error);
        return res.status(500).send({ error: "Failed to set user role." });
    }
});


// --- ADMIN DASHBOARD ROUTES ---
app.get("/admin/verification-queue", verifyToken, isAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('partners').where('status', '==', 'pending').get();
        const pendingPartners = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
        return res.status(200).json(pendingPartners);
    } catch (error) {
        console.error("Error fetching verification queue:", error);
        return res.status(500).send({ error: "Could not fetch verification queue." });
    }
});

app.post("/admin/update-partner-status", verifyToken, isAdmin, async (req, res) => {
    const { id: partnerId, status } = req.body; // status should be 'verified' or 'rejected'
    if (!partnerId || !['verified', 'rejected'].includes(status)) {
        return res.status(400).send("Invalid request body.");
    }
    try {
        const partnerRef = db.collection('partners').doc(partnerId);
        await partnerRef.update({ status });

        if (status === 'verified') {
             // Set custom claim to identify user as a partner
            await admin.auth().setCustomUserClaims(partnerId, { role: 'partner' });
            
            // Also create a public resource document
            const partnerDoc = await partnerRef.get();
            if (partnerDoc.exists) {
                const partnerData = partnerDoc.data();

                // TODO: Use a Geocoding API (e.g., Google Maps Geocoding API) to get lat/lon from partnerData.location.
                // For now, using mock coordinates for demo purposes (Los Angeles area).
                const mockLat = 34.0522 + (Math.random() - 0.5) * 0.2;
                const mockLon = -118.2437 + (Math.random() - 0.5) * 0.2;

                const newResource = {
                    name: partnerData.name,
                    category: partnerData.services[0] || 'Other', // Use the first service as the primary category
                    lat: mockLat,
                    lon: mockLon,
                    contact: partnerData.contact,
                    type: partnerData.resourceType,
                    openHours: partnerData.openHours,
                    rating: 0, // Initial rating
                    description: partnerData.description,
                    verified: true,
                    source: 'Community', // Identify this as a community-submitted resource
                    partnerId: partnerId, // Link back to the partner document
                };
                await db.collection('resources').add(newResource);
            }
        } else if (status === 'rejected') {
            // Optionally remove user claims if they were previously a partner
            await admin.auth().setCustomUserClaims(partnerId, { role: null });
        }

        return res.status(200).send({ message: `Partner ${partnerId} status updated to ${status}.` });
    } catch (error) {
        console.error("Error updating partner status:", error);
        return res.status(500).send({ error: "Failed to update partner status." });
    }
});

app.get("/admin/dashboard-data", verifyToken, isAdmin, async (req, res) => {
    try {
        const resourcesPromise = db.collection('resources').where('verified', '==', true).count().get();
        const partnersPromise = db.collection('partners').where('status', '==', 'pending').count().get();
        const volunteersPromise = db.collection('volunteers').where('status', '==', 'pending').count().get();
        
        const [resourcesSnap, partnersSnap, volunteersSnap] = await Promise.all([resourcesPromise, partnersPromise, volunteersPromise]);

        const data = {
            totalResources: resourcesSnap.data().count,
            pendingPartners: partnersSnap.data().count,
            pendingVolunteers: volunteersSnap.data().count,
        };
        return res.status(200).json(data);
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
        return res.status(500).send({ error: "Could not fetch dashboard data." });
    }
});

app.get("/admin/users", verifyToken, isAdmin, async (req, res) => {
    try {
        const listUsersResult = await admin.auth().listUsers(1000);
        const users = listUsersResult.users.map((userRecord) => {
            return {
                uid: userRecord.uid,
                email: userRecord.email,
                role: userRecord.customClaims?.role || 'user',
            };
        });
        return res.status(200).json(users);
    } catch (error) {
        console.error("Error fetching users:", error);
        return res.status(500).send({ error: "Could not fetch user list." });
    }
});


// --- VOLUNTEER ROUTES ---

// Public route for volunteer registration
app.post("/volunteers/register", async (req, res) => {
    try {
        const { name, email, phone, skills, availability, interest, documentUrl } = req.body;
        if (!name || !email || !phone || !skills || !availability || !interest || !documentUrl) {
            return res.status(400).send({ error: "Missing required fields." });
        }
        const newVolunteer = {
            name, email, phone, skills, availability, interest, documentUrl,
            status: 'pending',
            submittedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('volunteers').add(newVolunteer);
        return res.status(201).send({ message: "Volunteer application submitted.", id: docRef.id });
    } catch (error) {
        console.error("Error submitting volunteer application:", error);
        return res.status(500).send({ error: "Failed to submit application." });
    }
});

// Admin route to get pending volunteers
app.get("/admin/volunteers/queue", verifyToken, isAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('volunteers').where('status', '==', 'pending').get();
        const pendingVolunteers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
        return res.status(200).json(pendingVolunteers);
    } catch (error) {
        console.error("Error fetching volunteer queue:", error);
        return res.status(500).send({ error: "Could not fetch volunteer queue." });
    }
});

// Admin route to update volunteer status
app.post("/admin/update-volunteer-status", verifyToken, isAdmin, async (req, res) => {
    const { id, status } = req.body;
    if (!id || !['verified', 'rejected'].includes(status)) {
        return res.status(400).send("Invalid request body.");
    }
    try {
        const volunteerRef = db.collection('volunteers').doc(id);
        await volunteerRef.update({ status });

        if (status === 'verified') {
            const volunteerDoc = await volunteerRef.get();
            const volunteerData = volunteerDoc.data();

            // Find user by email to set custom claim
            try {
                const userRecord = await admin.auth().getUserByEmail(volunteerData.email);
                await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'volunteer' });
            } catch (err) {
                 console.log(`Could not find a registered user for volunteer email ${volunteerData.email}. No role set.`);
            }
        }
        
        return res.status(200).send({ message: `Volunteer ${id} status updated to ${status}.` });
    } catch (error) {
        console.error("Error updating volunteer status:", error);
        return res.status(500).send({ error: "Failed to update volunteer status." });
    }
});


// --- RESOURCE ROUTES (CRUD) ---

// CREATE a resource (Admin only)
app.post("/resources", verifyToken, isAdmin, async (req, res) => {
    try {
        const newResource = req.body;
        // Add server-side validation here
        const docRef = await db.collection('resources').add(newResource);
        return res.status(201).json({ id: docRef.id, ...newResource });
    } catch (error) {
        console.error("Error creating resource:", error);
        return res.status(500).send({ error: "Failed to create resource." });
    }
});

// READ all resources (Public)
app.get("/resources", async (req, res) => {
    try {
        const snapshot = await db.collection('resources').where('verified', '==', true).get();
        const resources = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json(resources);
    } catch (error) {
        console.error("Error fetching resources:", error);
        return res.status(500).send({ error: "Could not fetch resources." });
    }
});

// UPDATE a resource (Admin only)
app.put("/resources/:id", verifyToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updatedData = req.body;
        await db.collection('resources').doc(id).update(updatedData);
        return res.status(200).json({ id, ...updatedData });
    } catch (error) {
        console.error("Error updating resource:", error);
        return res.status(500).send({ error: "Failed to update resource." });
    }
});

// DELETE a resource (Admin only)
app.delete("/resources/:id", verifyToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('resources').doc(id).delete();
        return res.status(200).send({ message: `Resource ${id} deleted successfully.`});
    } catch (error) {
        console.error("Error deleting resource:", error);
        return res.status(500).send({ error: "Failed to delete resource." });
    }
});

// --- RESOURCE SUGGESTION (PUBLIC) ---
app.post("/resources/suggest", async (req, res) => {
    try {
        const { name, category, type, contact, openHours, description } = req.body;
        
        // Basic server-side validation
        if (!name || !category || !type || !contact || !description) {
            return res.status(400).send({ error: "Missing required fields." });
        }

        const newResourceSuggestion = {
            name, category, type, contact, openHours, description,
            verified: false,
            status: 'pending', // for admin review
            rating: 0,
            source: 'CommunitySuggestion',
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            // lat/lon will be added by an admin during verification
            lat: null,
            lon: null,
        };

        const docRef = await db.collection('resources').add(newResourceSuggestion);
        
        return res.status(201).send({ message: "Resource suggestion submitted successfully.", id: docRef.id });
    } catch (error) {
        console.error("Error submitting resource suggestion:", error);
        return res.status(500).send({ error: "Failed to submit resource suggestion." });
    }
});

// --- FEEDBACK ROUTES ---

// CREATE feedback (Public)
app.post("/feedback", async (req, res) => {
    try {
        const newFeedback = {
            ...req.body,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
        const docRef = await db.collection('feedback').add(newFeedback);
        const feedbackDoc = await docRef.get();
        return res.status(201).json({ id: docRef.id, ...feedbackDoc.data() });
    } catch (error) {
        console.error("Error submitting feedback:", error);
        return res.status(500).send({ error: "Failed to submit feedback." });
    }
});


// Export the API
exports.api = functions.https.onRequest(app);