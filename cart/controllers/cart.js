const Cart = require("../models/Cart");
const axios = require("axios");
require("dotenv").config();

const SERVICE = "cart";

const handleCustomError = async (errorCode, res) => {
  try {
    switch (errorCode) {
      case "501":
        throw new Error("501 Error: Not Implemented");
      case "502":
        await simulateUpstreamServiceFailure();
        break;
      case "503":
        simulateServerOverload();
        break;
      default:
        throw new Error(`Unknown Error Code: ${errorCode}`);
    }
  } catch (error) {
    console.error(error.stack || error.message);
    const statusCode = parseInt(errorCode, 10) || 400;
    res.status(statusCode).json({
      message: error.message,
      error: error.stack,
    });
  }
};

const simulateUpstreamServiceFailure = async () => {
  try {
    await axios.get("https://nonexistent-url.fakeapi.com");
  } catch (error) {
    throw new Error("502 Error: Bad Gateway");
  }
};

const simulateServerOverload = () => {
  throw new Error("503 Error: Service Unavailable");
};

const checkErrorInjection = (req, res) => {
  const errorCode = req.headers["error-code"];
  const errorService = req.headers["error-service"];

  if (errorCode && errorService && errorService === SERVICE) {
    handleCustomError(errorCode, res);
    return true;
  }
  return false;
};

const addToCart = async (req, res) => {
  if (checkErrorInjection(req, res)) return;

  const headers = req.headers;
  const errorHeaders = {};

  if (headers["error-service"] && headers["error-code"]) {
    errorHeaders["error-service"] = headers["error-service"];
    errorHeaders["error-code"] = headers["error-code"];
  }

  const { userId, productId, quantity } = req.body;

  const parsedUserId = Number(userId);
  const parsedProductId = Number(productId);
  const parsedQuantity = Number(quantity);

  if (isNaN(parsedUserId) || isNaN(parsedProductId) || isNaN(parsedQuantity)) {
    const error = new Error(
      `Invalid userId, productId, or quantity: ${userId}, ${productId}, ${quantity}`
    );
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  await axios.get(`${process.env.USER_RESPONSE}/api/v1/${parsedUserId}`, {
    headers: { ...errorHeaders },
  });

  await axios.get(
    `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${parsedProductId}`,
    { headers: { ...errorHeaders } }
  );

  if (parsedProductId == 10) {
    const error = new Error(
      `Invalid product with the product id: ${productId}`
    );
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const existingCartItem = await Cart.findOne({
    where: { userId: parsedUserId, productId: parsedProductId },
  });

  if (existingCartItem) {
    const newQuantity = existingCartItem.quantity + parsedQuantity;
    await existingCartItem.update({ quantity: newQuantity });

    return res.status(200).json({
      cartItem: existingCartItem,
      message: `Quantity updated in the cart for product ${parsedProductId}`,
    });
  }

  const newCartItem = await Cart.create({
    userId: parsedUserId,
    productId: parsedProductId,
    quantity: parsedQuantity,
  });

  res.status(201).json({
    cartItem: newCartItem,
    message: "Item Added To The Cart",
  });
};

const getCartItems = async (req, res) => {
  if (checkErrorInjection(req, res)) return;

  const { userId } = req.body;

  const headers = req.headers;
  const errorHeaders = {};

  if (headers["error-service"] && headers["error-code"]) {
    errorHeaders["error-service"] = headers["error-service"];
    errorHeaders["error-code"] = headers["error-code"];
  }

  if (!userId) {
    return res.status(400).json({
      message: "userId is required"
    });
  }
  // if (!userId) {
  //   const error = new Error("Http Error: 400");
  //   error.statusCode = 400;
  //   console.error(error.stack);
  //   throw error;
  // }

  const userResponse = await axios.get(
    `${process.env.USER_RESPONSE}/api/v1/${userId}`,
    { headers: { ...errorHeaders } }
  );

  if (!userResponse.data) {
    return res.status(400).json({
      message: "Invalid user"
    });
  }
  // if (!userResponse.data) {
  //   const error = new Error("Invalid user");
  //   error.statusCode = 400;
  //   console.error(error.stack);
  //   throw error;
  // }

  const cartItems = await Cart.findAll({ where: { userId } });

  const cartItemsWithProductDetails = await Promise.all(
    cartItems.map(async (cartItem) => {
      const { productId, quantity } = cartItem;

      try {
        const productResponse = await axios.get(
          `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${productId}`,
          { headers: { ...errorHeaders } }
        );

        if (productResponse.data) {
          return {
            productId,
            title: productResponse.data.title,
            description: productResponse.data.description,
            image: productResponse.data.image,
            price: productResponse.data.price,
            quantity,
          };
        } else {
          console.error(
            `Product details not found for productId: ${productId}`
          );
          return null;
        }
      } catch (error) {
        console.error("Error fetching product details:", error);
        return null;
      }
    })
  );

  const validCartItems = cartItemsWithProductDetails.filter(
    (item) => item !== null
  );

  return res.status(200).json(validCartItems);
};

const deleteCartItem = async (req, res) => {
  if (checkErrorInjection(req, res)) return;

  const { userId, productId } = req.body;

  const userResponse = await axios.get(
    `${process.env.USER_RESPONSE}/api/v1/${userId}`
  );

  if (!userResponse.data) {
    const error = new Error("Invalid user");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const existingCartItem = await Cart.findOne({
    where: { userId, productId },
  });

  if (!existingCartItem) {
    const error = new Error("Product not found in the cart");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  await existingCartItem.destroy();

  return res.status(200).json({
    message: "Product removed from the cart",
  });
};

const updateCart = async (req, res) => {
  if (checkErrorInjection(req, res)) return;

  const { userId, productId, quantity } = req.body;

  await axios.get(`${process.env.USER_RESPONSE}/api/v1/${userId}`);
  await axios.get(
    `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${productId}`
  );

  const existingCartItem = await Cart.findOne({
    where: { userId, productId },
  });

  if (!existingCartItem) {
    const error = new Error("Product not found in the cart");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  if (Number(quantity) === 0) {
    await existingCartItem.destroy();
  } else {
    await existingCartItem.update({ quantity: Number(quantity) });
  }

  return res.status(200).json({
    message: "Cart item updated successfully",
  });
};

const deleteAllCartItems = async (req, res) => {
  if (checkErrorInjection(req, res)) return;

  const { userId } = req.body;

  const userResponse = await axios.get(
    `${process.env.USER_RESPONSE}/api/v1/${userId}`
  );

  if (!userResponse.data) {
    const error = new Error("Invalid user");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const deletedCount = await Cart.destroy({ where: { userId } });

  if (deletedCount > 0) {
    return res.status(200).json({
      message: "All cart items removed",
    });
  }

  const error = new Error("Cart not found or there are no items to delete");
  error.statusCode = 400;
  throw error;
};

module.exports = {
  addToCart,
  deleteCartItem,
  getCartItems,
  updateCart,
  deleteAllCartItems,
};




// const Cart = require("../models/Cart");
// const axios = require("axios");
// const dotenv = require("dotenv").config();
// // const newrelic = require("newrelic");
// const SERVICE = "cart";

// // const newRelicWrapper = (handler) => {
// //   return async (req, res) => {
// //     const errorCode = req.headers["error-code"];
// //     const errorService = req.headers["error-service"];
// //     if (errorCode && errorService && errorService == SERVICE) {
// //       handleCustomError(errorCode, res);
// //       return;
// //     }
// //     try {
// //       await handler(req, res);
// //     } catch (error) {
// //       const statusCode = error.response?.status || error?.statusCode || 500;
// //       console.log("Error in cart", error);
// //       newrelic.noticeError(error, { context: error.message });
// //       return res.status(statusCode).json({
// //         message: error.message,
// //         error,
// //         statusCode,
// //       });
// //     }
// //   };
// // };

// const handleCustomError = async (errorCode, res) => {
//   try {
//     switch (errorCode) {
//       case "501":
//         throw new Error("501 Error: Not Implemented");
//       case "502":
//         await simulateUpstreamServiceFailure();
//         break;
//       case "503":
//         simulateServerOverload();
//         break;
//       default:
//         throw new Error(`Unknown Error Code: ${errorCode}`);
//     }
//   } catch (error) {
//     console.error(error.stack || error.message);
    
//     // newrelic.noticeError(error, { context: { errorCode, stack: error.stack } });
//     const statusCode = parseInt(errorCode, 10) || 400;
//     res.status(statusCode).json({ message: error.message, error: error.stack });
//   }
// };

// const simulateUpstreamServiceFailure = async () => {
//   try {
//     await axios.get("https://nonexistent-url.fakeapi.com");
//   } catch (error) {
//     throw new Error("502 Error: Bad Gateway");
//   }
// };

// const simulateServerOverload = () => {
//   // Simulate server overload by throwing an error
//   throw new Error("503 Error: Service Unavailable");
// };

// const addToCart = async (req, res) => {
//   const headers = req.headers;
//   const errorHeaders = {};
//   if (headers["error-service"] && headers["error-code"]) {
//     errorHeaders["error-service"] = headers["error-service"];
//     errorHeaders["error-code"] = headers["error-code"];
//   }
//   const { userId, productId, quantity } = req.body;

//   const parsedUserId = Number(userId);
//   const parsedProductId = Number(productId);
//   const parsedQuantity = Number(quantity);

//   if (isNaN(parsedUserId) || isNaN(parsedProductId) || isNaN(parsedQuantity)) {
//     const error = new Error(
//       `Invalid userId, productId, or quantity: ${userId}, ${productId}, ${quantity}`
//     );
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   const userResponse = await axios.get(
//     `${process.env.USER_RESPONSE}/api/v1/${parsedUserId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );
//   const productResponse = await axios.get(
//     `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${parsedProductId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );

//   if (parsedProductId == 10) {
//     const error = new Error(
//       `Invalid product with the product id: ${productId}`
//     );
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   const existingCartItem = await Cart.findOne({
//     where: { userId: parsedUserId, productId: parsedProductId },
//   });

//   if (existingCartItem) {
//     const newQuantity = existingCartItem.quantity + parsedQuantity;
//     await existingCartItem.update({ quantity: newQuantity });
//     return res.status(200).json({
//       cartItem: existingCartItem,
//       message: `Quantity updated in the cart for product ${parsedProductId}`,
//     });
//   }

//   const newCartItem = await Cart.create({
//     userId: parsedUserId,
//     productId: parsedProductId,
//     quantity: parsedQuantity,
//   });

//   res.status(201).json({
//     cartItem: newCartItem,
//     message: "Item Added To The Cart",
//   });
// };

// const getCartItems = async (req, res) => {
//   const { userId } = req.body;
//   const headers = req.headers;
//   const errorHeaders = {};
//   if (headers["error-service"] && headers["error-code"]) {
//     errorHeaders["error-service"] = headers["error-service"];
//     errorHeaders["error-code"] = headers["error-code"];
//   }

//   if (!userId) {
//     const error = new Error("Http Error: 400");
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   const userResponse = await axios.get(
//     `${process.env.USER_RESPONSE}/api/v1/${userId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );

//   if (!userResponse.data) {
//     const error = new Error("Invalid user");
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   const cartItems = await Cart.findAll({ where: { userId } });

//   const cartItemsWithProductDetails = await Promise.all(
//     cartItems.map(async (cartItem) => {
//       const { productId, quantity } = cartItem;

//       try {
//         const productResponse = await axios.get(
//           `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${productId}`,
//           {
//             headers: { ...errorHeaders },
//           }
//         );

//         if (productResponse.data) {
//           return {
//             productId: productId,
//             title: productResponse.data.title,
//             description: productResponse.data.description,
//             image: productResponse.data.image,
//             price: productResponse.data.price,
//             quantity: quantity,
//           };
//         } else {
//           console.error(
//             `Product details not found for productId: ${productId}`
//           );
//           return null;
//         }
//       } catch (error) {
//         console.error("Error fetching product details:", error);
//         return null;
//       }
//     })
//   );

//   const validCartItems = cartItemsWithProductDetails.filter(
//     (item) => item !== null
//   );

//   return res.status(200).json(validCartItems);
// };

// const deleteCartItem = async (req, res) => {
//   const { userId, productId } = req.body;
//   const headers = req.headers;
//   const errorHeaders = {};
//   if (headers["error-service"] && headers["error-code"]) {
//     errorHeaders["error-service"] = headers["error-service"];
//     errorHeaders["error-code"] = headers["error-code"];
//   }
//   const userResponse = await axios.get(
//     `${process.env.USER_RESPONSE}/api/v1/${userId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );

//   if (!userResponse.data) {
//     const error = new Error("Invalid user");
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   const existingCartItem = await Cart.findOne({
//     where: { userId, productId },
//   });

//   if (!existingCartItem) {
//     const error = new Error("Product not found in the cart");
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   await existingCartItem.destroy();
//   return res.status(200).json({
//     message: "Product removed from the cart",
//   });
// };

// const updateCart = async (req, res) => {
//   const { userId, productId, quantity } = req.body;
//   const headers = req.headers;
//   const errorHeaders = {};
//   if (headers["error-service"] && headers["error-code"]) {
//     errorHeaders["error-service"] = headers["error-service"];
//     errorHeaders["error-code"] = headers["error-code"];
//   }
//   const userResponse = await axios.get(
//     `${process.env.USER_RESPONSE}/api/v1/${userId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );
//   const productResponse = await axios.get(
//     `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${productId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );

//   const existingCartItem = await Cart.findOne({
//     where: { userId, productId },
//   });

//   if (!existingCartItem) {
//     const error = new Error("Product not found in the cart");
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   if (Number(quantity) === 0) {
//     await existingCartItem.destroy();
//   } else {
//     await existingCartItem.update({ quantity: Number(quantity) });
//   }

//   return res.status(200).json({
//     message: "Cart item updated successfully",
//   });
// };

// const deleteAllCartItems = async (req, res) => {
//   const { userId } = req.body;
//   const headers = req.headers;
//   const errorHeaders = {};
//   if (headers["error-service"] && headers["error-code"]) {
//     errorHeaders["error-service"] = headers["error-service"];
//     errorHeaders["error-code"] = headers["error-code"];
//   }
//   const userResponse = await axios.get(
//     `${process.env.USER_RESPONSE}/api/v1/${userId}`,
//     {
//       headers: { ...errorHeaders },
//     }
//   );

//   if (!userResponse.data) {
//     const error = new Error("Invalid user");
//     error.statusCode = 400;
//     console.error(error.stack);
//     throw error;
//   }

//   const deletedCount = await Cart.destroy({ where: { userId } });

//   if (deletedCount > 0) {
//     return res.status(200).json({
//       message: "All cart items removed",
//     });
//   } else {
//     console.error(
//       `Cart not found or there are no items to delete for userId: ${userId}`
//     );

//     const error = new Error("Cart not found or there are no items to delete");
//     error.statusCode = 400;
//     throw error;
//   }
// };

// module.exports = {
//   addToCart,
//   deleteCartItem,
//   getCartItems,
//   updateCart,
//   deleteAllCartItems,
// };

// // module.exports = {
// //   addToCart: newRelicWrapper(addToCart),
// //   deleteCartItem: newRelicWrapper(deleteCartItem),
// //   getCartItems: newRelicWrapper(getCartItems),
// //   updateCart: newRelicWrapper(updateCart),
// //   deleteAllCartItems: newRelicWrapper(deleteAllCartItems),
// // };
