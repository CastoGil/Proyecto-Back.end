import express from "express";
import { admin, authorize } from "../middlewares/index.js";
import {
  getAllProductsController,
  getProductByIdController,
  createProductController,
  updateProductController,
  deleteProductController,
} from "../controllers/controllerDb/productsController.js";
import generateMockProducts from "../utils.js";

const router = express.Router();

// Rutas de productos
router.get("/", admin, getAllProductsController);
router.get("/mockingproducts", async (req, res) => {
  const mockProducts = generateMockProducts(100);
  res.json(mockProducts);
});
router.get("/:pid", getProductByIdController);
router.post("/", admin, authorize, createProductController);
router.put("/:pid", admin, authorize, updateProductController);
router.delete("/:pid", admin, authorize, deleteProductController);

export default router;
