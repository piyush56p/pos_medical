const app = require("express")();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const { PostgresStore } = require("./postgres-store");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const validator = require("validator");

app.use(bodyParser.json());

module.exports = app;

let usersDB = new PostgresStore({ collection: "users" });

usersDB.ensureIndex({ fieldName: "username", unique: true });

/**
 * GET endpoint: Get the welcome message for the Users API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/", function (req, res) {
    res.send("Users API");
});

/**
 * GET endpoint: Get user details by user ID.
 *
 * @param {Object} req request object with user ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/user/:userId", function (req, res) {
    if (!req.params.userId) {
        res.status(500).send("ID field is required.");
    } else {
        usersDB.findOne(
            {
                _id: parseInt(req.params.userId),
            },
            function (err, docs) {
                if (docs) {
                    const { password, ...user } = docs;
                    res.send(user);
                } else {
                    res.sendStatus(404);
                }
            },
        );
    }
});

/**
 * GET endpoint: Log out a user by updating the user status.
 *
 * @param {Object} req request object with user ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/logout/:userId", function (req, res) {
    if (!req.params.userId) {
        res.status(500).send("ID field is required.");
    } else {
        req.session.destroy((error) => {
            if (error) {
                return res.sendStatus(500);
            }
            res.clearCookie("connect.sid");
            res.sendStatus(200);
        });
    }
});

/**
 * POST endpoint: Authenticate user login and update user status.
 *
 * @param {Object} req request object with login credentials in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/login", function (req, res) {
    usersDB.findOne(
        {
            username: validator.escape(req.body.username),
        },
        function (err, docs) {
            if (docs) {
                //verify password
                bcrypt
                    .compare(req.body.password, docs.password)
                    .then((result) => {
                        if (result) {
                            req.session.regenerate((sessionError) => {
                                if (sessionError) {
                                    return res.sendStatus(500);
                                }
                                req.session.userId = String(docs._id);
                                const { password, ...user } = docs;
                                req.session.user = user;
                                req.session.save((saveError) => {
                                    if (saveError) {
                                        return res.sendStatus(500);
                                    }
                                    res.send({ ...user, auth: true });
                                });
                            });
                        }
                        //Invalid password
                        else res.send({ auth: false });
                    })
                    .catch((err) =>
                        res.send({ auth: false, message: err.message }),
                    );
            }
            //No user Account
            else res.send({ auth: false });
        },
    );
});

/**
 * GET endpoint: Get details of all users.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
app.get("/all", function (req, res) {
    usersDB.find({}, function (err, docs) {
        res.send((docs || []).map(({ password, ...user }) => user));
    });
});

/**
 * DELETE endpoint: Delete a user by user ID.
 *
 * @param {Object} req request object with user ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
app.delete("/user/:userId", function (req, res) {
    res.status(403).json({ error: "Staff accounts are disabled." });
});

/**
 * POST endpoint: Create or update a user.
 *
 * @param {Object} req request object with user data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
app.post("/post", function (req, res) {
    res.status(403).json({ error: "Staff accounts are disabled." });
});

/**
 * GET endpoint: Check and initialize the default admin user if not exists.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
