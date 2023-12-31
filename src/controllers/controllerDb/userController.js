import { userService } from "../../services/userService.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import passport from "passport";
import fs from "fs";
import UserDto from "../../Dto/userDto.js";
dotenv.config();
import { generateUserError } from "../../services/errors/info.js";
import CustomError from "../../services/errors/CustomError.js";
import EErrors from "../../services/errors/enums.js";
import { getLogger } from "../../utils.js";
import {
  sendPasswordResetEmail,
  sendAccountDeletionEmail,
} from "../../config/nodemailer.config.js";
import { cartController } from "./cartController.js";
const logger = getLogger();
const jwtSecret = process.env.JWT_SECRET;

const showRegisterForm = (req, res) => {
  res.render("register");
};
const processRegisterForm = async (req, res, next) => {
  try {
    const { first_name, last_name, email, age, password } = req.body;
    const requiredFields = [
      "first_name",
      "last_name",
      "age",
      "email",
      "password",
    ];

    const isValidUser = requiredFields.every((field) =>
      req.body.hasOwnProperty(field)
    );

    if (!isValidUser) {
      const errorMessage = generateUserError(req.body);
      return next(
        new CustomError({
          name: "User creation error",
          cause: errorMessage,
          message: "Error trying to create User",
          code: EErrors.INVALID_TYPES_ERROR,
        })
      );
    }

    const existingUser = await userService.getUserByEmail(email);

    if (existingUser) {
      logger.info("El usuario ya está registrado");
      return res.render("register", { error: "El usuario ya está registrado" });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const user = await userService.createUser(
      first_name,
      last_name,
      email,
      age,
      hashedPassword,
      "usuario"
    );

    const userDto = new UserDto(
      user.first_name,
      user.last_name,
      user.email,
      user.age,
      user.role
    );
    logger.info(userDto);

   
    const loginPromise = (user) => {
      return new Promise((resolve, reject) => {
        req.login(user, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };

    await loginPromise(user); 

    const tokenPayload = {
      Id: user._id,
      first_name: user.first_name,
      role: user.role,
      email: user.email,
    };

    const token = jwt.sign(tokenPayload, jwtSecret);
    res.cookie("token", token, { httpOnly: true, sameSite: true });

    const newCart = await cartController.createCart(req, res, next);
    if (!newCart || !newCart.id) {
      throw new Error("El carrito no se creó correctamente");
    }
    const cartId = newCart.id;
    req.user.cart = cartId;
    await req.user.save();

    // Actualizar last_connection al inicio de sesión
    req.user.last_connection = new Date();
    await req.user.save();

    return res.redirect(`/api/products?cartId=${cartId}`);
  } catch (error) {
    if (error instanceof CustomError) {
      next(error);
    } else {
      next(
        new CustomError({
          name: "Database Error",
          message: "An error occurred while communicating with the database.",
          cause: error,
          code: EErrors.DATABASE_ERROR,
        })
      );
    }
  }
};


const showLoginForm = (req, res) => {
  res.render("login");
};

const processLoginForm = async (req, res, next) => {
  passport.authenticate(
    "local",
    { session: false },
    async (err, user, info) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.render("login", { error: info.message });
      }
      try {
        const token = jwt.sign(
          {
            Id: user._id,
            first_name: user.first_name,
            role: user.role,
            email: user.email,
          },
          jwtSecret
        );
        res.cookie("token", token, { httpOnly: true });

       
        const newCart = await cartController.createCart(req, res, next);
        if (!newCart || !newCart.id) {
          throw new Error("El carrito no se creó correctamente");
        }
        const cartId = newCart.id;
       
        user.cart = cartId;
        await user.save();

        
        user.last_connection = new Date();
        await user.save();

        return res.redirect(`/api/products?cartId=${cartId}`); 

      } catch (error) {
        console.error(error);
        return res.status(500).send("Error interno del servidor"); 
      }
    }
  )(req, res, next);
};

const github = async (req, res, next) => {
  const token = jwt.sign(
    {
      Id: req.user._id,
      first_name: req.user.first_name,
      role: req.user.role,
    },
    jwtSecret
  );
  res.cookie("token", token, { httpOnly: true });

 
  const newCart = await cartController.createCart(req, res, next);
  if (!newCart || !newCart.id) {
    throw new Error("El carrito no se creó correctamente");
  }
  const cartId = newCart.id;

  req.user.cart = cartId;
  await req.user.save();

 
  req.user.last_connection = new Date();
  await req.user.save();

  return res.redirect(`/api/products?cartId=${cartId}`); 
};

const showPasswordResetRequestForm = (req, res) => {
  res.render("password-reset-request");
};

const processPasswordResetRequest = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await userService.getUserByEmail(email);
    if (!user) {
      return res.render("login", { error: "El usuario no existe" });
    }

    const resetToken = jwt.sign({ userId: user._id }, jwtSecret, {
      expiresIn: "1h",
    });
    
    user.resetToken = resetToken;
    user.resetTokenExpiration = Date.now() + 3600000; //
    await user.save();

    console.log(user.email)
    const resetPasswordLink = `${req.protocol}://${req.get(
      "host"
    )}/auth/password/reset/${resetToken}`;
    
    await sendPasswordResetEmail(user.email, resetPasswordLink);
    console.log(resetPasswordLink)
    res.render("login", {
      success:
        "Se ha enviado un correo con las instrucciones para restablecer la contraseña",
    });
  } catch (error) {
    console.log(error);
    res.render("login", { error: "Error en el servidor" });
  }
};

const showPasswordResetExpiredPage = (req, res) => {
  res.render("password-reset-expired");
};

const showPasswordResetForm = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await userService.getUserByResetToken(token);
    if (!user) {
      return res.render("password-reset-expired");
    }
    res.render("password-reset", { token });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

const processPasswordReset = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    const user = await userService.getUserByResetToken(token);
    if (!user) {
      return res.render("password-reset-expired");
    }
    if (user.resetTokenExpiration < Date.now()) {
      return res.render("password-reset-expired");
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetToken = null;
    user.resetTokenExpiration = null;
    await user.save();

    res.redirect("/auth/login?resetSuccess=true");
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error en el servidor" });
  }
};

const closeSession = async (req, res) => {
  res.clearCookie("token");
  res.clearCookie("role");
  req.logout(function (err) {
    if (err) return next(err);
    req.session.destroy(function (err) {
      if (err) return next(err);
      res.redirect("/auth/login");
    });
  });
};

const changeUserRoleController = async (req, res, next) => {
  try {
    const { uid } = req.params;
    const user = await userService.getUserById(uid);
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const requiredDocuments = [
      "identification",
      "addressProof",
      "accountProof",
    ];
    const uploadedDocuments = user.documents.map(
      (document) => document.name.split(" ")[0]
    );
    const missingDocuments = requiredDocuments.filter(
      (document) => !uploadedDocuments.includes(document)
    );

    if (user.role === "usuario" && missingDocuments.length > 0) {
      return res.status(400).render("changeUserRole", {
        error:
          "El usuario no ha terminado de procesar su documentación. Por favor, cargue los siguientes documentos: " +
          missingDocuments.join(", "),
        success: false,
        missingDocuments,
        userDto: null,
      });
    }

    // Cambiar el rol del usuario
    if (user.role === "usuario") {
      user.role = "premium";
      await user.save();
    }

    const userDto = {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      age: user.age,
      role: user.role,
    };

    res.render("changeUserRole", {
      error: null,
      success: true,
      missingDocuments,
      userDto,
    });
  } catch (error) {
    if (error instanceof CustomError) {
      next(error);
    } else {
      next(
        new CustomError({
          name: "Database Error",
          message: "An error occurred while communicating with the database.",
          cause: error,
          code: EErrors.DATABASE_ERROR,
        })
      );
    }
  }
};

const loadDocuments = async (req, res) => {
  const uid = req.params.uid;
  const { profileImage, identification, addressProof, accountProof } =
    req.files;
  try {
    const user = await userService.getUserById(uid);
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // Verificar si los documentos ya han sido cargados
    const uploadedDocuments = user.documents.map((document) => document.name);
    const requiredDocuments = [
      "identification",
      "addressProof",
      "accountProof",
    ];
    const missingDocuments = requiredDocuments.filter(
      (document) => !uploadedDocuments.includes(document)
    );

    if (missingDocuments.length === 0) {
      return res
        .status(400)
        .json({ error: "Los documentos ya han sido cargados" });
    }

    // Manejar los archivos de la imagen de perfil
    if (profileImage && profileImage.length > 0) {
      const profileImagePath = `src/uploads/profiles/${profileImage[0].filename}`;
      fs.renameSync(profileImage[0].path, profileImagePath);
      const profileImageDocument = {
        name: "profileImage",
        reference: profileImagePath,
        status: "subido",
      };
      user.documents.push(profileImageDocument);
    }

    // Manejar el archivo de identificación
    if (
      identification &&
      identification.length > 0 &&
      missingDocuments.includes("identification")
    ) {
      const identificationPath = `src/uploads/documents/${identification[0].filename}`;
      fs.renameSync(identification[0].path, identificationPath);
      const identificationDocument = {
        name: "identification",
        reference: identificationPath,
        status: "subido",
      };
      user.documents.push(identificationDocument);
    }

    // Manejar el archivo de comprobante de domicilio
    if (
      addressProof &&
      addressProof.length > 0 &&
      missingDocuments.includes("addressProof")
    ) {
      const addressProofPath = `src/uploads/documents/${addressProof[0].filename}`;
      fs.renameSync(addressProof[0].path, addressProofPath);
      const addressProofDocument = {
        name: "addressProof",
        reference: addressProofPath,
        status: "subido",
      };
      user.documents.push(addressProofDocument);
    }

    // Manejar el archivo de comprobante de estado de cuenta
    if (
      accountProof &&
      accountProof.length > 0 &&
      missingDocuments.includes("accountProof")
    ) {
      const accountProofPath = `src/uploads/documents/${accountProof[0].filename}`;
      fs.renameSync(accountProof[0].path, accountProofPath);
      const accountProofDocument = {
        name: "accountProof",
        reference: accountProofPath,
        status: "subido",
      };
      user.documents.push(accountProofDocument);
    }

    await user.save();
    console.log(user);
    res.json({
      message: "Archivos subidos exitosamente",
      user: user.documents,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar el usuario" });
  }
};

const getAllUsersData = async () => {
  const users = await userService.getAllUsers();
  return users.map((user) => ({
    first_name: user.first_name,
    email: user.email,
    accountType: user.role,
  }));
};

const getAllUsers = async (req, res) => {
  try {
    const userDtoList = await getAllUsersData();
    res.render('allUsers', { users: userDtoList, showInactive: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener los usuarios" });
  }
};

const getInactiveUsers = async (req, res) => {
  try {
    const cutoffDate = new Date(Date.now() - 2 * 60 * 1000);
    const inactiveUsers = await userService.getInactiveUsers(cutoffDate);
    res.json({ inactiveUsers })
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener los usuarios inactivos" });
  }
};

const deleteInactiveUsers = async (req, res) => {
  try {
    const cutoffDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const inactiveUsers = await userService.getInactiveUsers(cutoffDate);

    for (const user of inactiveUsers) {
      await sendAccountDeletionEmail(user.email)
      await userService.deleteUser(user._id);
    }

    const userDtoList = await getAllUsersData();
    res.render('allUsers', { users: userDtoList, showInactive: true, inactiveUsers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al eliminar los usuarios inactivos" });
  }
};

const getAllUsersAdmin = async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    const formattedUsers = users.map(user => ({
      ...user.toObject(),
      _id: user._id.toString()
    }));
    res.render("adminUsers", { users: formattedUsers });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al obtener los usuarios");
  }
};

const deleteUserAdmin = async (req, res) => {
  const userId = req.params.id;
  try {
    await userService.deleteUser(userId);
    res.redirect("/auth/admin");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al eliminar el usuario");
  }
};

const updateRole = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await userService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    // Cambiar el rol del usuario
    user.role = (user.role === "admin") ? "usuario" : "admin";
    await user.save(); 
    res.redirect("/auth/admin"); 
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al actualizar el rol del usuario");
  }
};

export {
  showLoginForm,
  processLoginForm,
  closeSession,
  showRegisterForm,
  processRegisterForm,
  showPasswordResetRequestForm,
  processPasswordResetRequest,
  showPasswordResetExpiredPage,
  showPasswordResetForm,
  processPasswordReset,
  changeUserRoleController,
  loadDocuments,
  getAllUsers,
  deleteInactiveUsers,
  getAllUsersAdmin,
  deleteUserAdmin,
  updateRole,
  github,
  getInactiveUsers
};
