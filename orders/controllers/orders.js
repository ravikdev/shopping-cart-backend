const Order = require("../models/Order");
const axios = require("axios");
require("dotenv").config();

const SERVICE = "orders";

const errorHandlerWrapper = (handler) => {
  return async (req, res) => {
    const errorCode = req.headers["error-code"];
    const errorService = req.headers["error-service"];

    if (errorCode && errorService && errorService == SERVICE) {
      handleCustomError(errorCode, res);
      return;
    }

    try {
      await handler(req, res);
    } catch (error) {
      const statusCode = error.response?.status || error?.statusCode || 500;

      console.error("Error in orders:", error);

      return res.status(statusCode).json({
        message: error.message,
        error,
        statusCode,
      });
    }
  };
};

const handleCustomError = async (errorCode, res) => {
  try {
    let error;

    switch (errorCode) {
      case "501":
        error = new Error("Not Implemented");
        error.name = "NotImplementedError";
        error.code = 501;
        error.service = SERVICE;
        error.details =
          "This feature or endpoint has not been implemented yet.";
        throw error;

      case "502":
        await simulateUpstreamServiceFailure();
        break;

      case "503":
        simulateServerOverload();
        break;

      default:
        error = new Error(`Unknown Error Code: ${errorCode}`);
        error.name = "CustomError";
        error.code = parseInt(errorCode, 10) || 400;
        error.service = SERVICE;
        throw error;
    }
  } catch (error) {
    const statusCode = error.code || parseInt(errorCode, 10) || 400;

    console.error("Custom Error:", error);

    res.status(statusCode).json({
      message: error.message,
      service: SERVICE,
      errorCode: errorCode,
      details: error.details || "An error occurred",
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



//lambda call to get orders
// const getOrders = async (req, res) => {

//   const { userId } = req.body;
//   const headers = req.headers;

//   if (!userId) {
//     const error = new Error("Http Error: 400");
//     error.statusCode = 400;
//     throw error;
//   }

//   try {

//     const lambdaResponse = await axios.post(
//       process.env.GET_ORDERS_LAMBDA_URL,
//       { userId },
//       {
//         headers: {
//           authorization: headers.authorization,
//           traceparent: headers.traceparent,
//           tracestate: headers.tracestate,
//           "error-service": headers["error-service"],
//           "error-code": headers["error-code"],
//           "Content-Type": "application/json"
//         },
//         timeout: 7000
//       }
//     );

//     return res.status(200).json(lambdaResponse.data);

//   } catch (error) {

//     console.error("Lambda error:", error.message);

//     const statusCode =
//       error.response?.status || error?.statusCode || 500;

//     return res.status(statusCode).json({
//       message: "Lambda service failed",
//       error: error.message
//     });

//   }

// };


const getOrders = async (req, res) => {
  const { userId } = req.body;
  const headers = req.headers;

  const errorHeaders = {};
  if (headers["error-service"] && headers["error-code"]) {
    errorHeaders["error-service"] = headers["error-service"];
    errorHeaders["error-code"] = headers["error-code"];
  }

  if (!userId) {
    const error = new Error("Http Error: 400");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const userResponse = await axios.get(
    `${process.env.USER_RESPONSE}/api/v1/${userId}`,
    {
      headers: { ...errorHeaders },
    }
  );

  if (!userResponse.data) {
    const error = new Error("Invalid user");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const orders = await Order.findAll({ where: { userId } });

  const ordersWithProductDetails = await Promise.all(
    orders.map(async (order) => {
      const products = order.products;

      try {
        const parsedProducts = JSON.parse(JSON.parse(products));

        const productsWithDetails = await Promise.all(
          parsedProducts.map(async (product) => {
            try {
              const productResponse = await axios.get(
                `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${product.productId}`,
                {
                  headers: { ...errorHeaders },
                }
              );

              if (productResponse.data) {
                return {
                  productId: product.productId,
                  title: productResponse.data.title,
                  description: productResponse.data.description,
                  image: productResponse.data.image,
                  quantity: product.quantity,
                  price: productResponse.data.price,
                };
              } else {
                return null;
              }
            } catch (error) {
              return {
                title: "Product Not Found",
                description: "Product details could not be retrieved",
                image: null,
                quantity: product.quantity,
                price: null,
              };
            }
          })
        );

        return {
          orderId: order.id,
          userId: order.userId,
          address: order.address,
          contactNo: order.contactNo,
          amount: order.price,
          date: order.date,
          products: productsWithDetails.filter((p) => p !== null),
        };
      } catch (parseError) {
        console.error("Error parsing products field:", parseError);
        return null;
      }
    })
  );

  // await axios.post(
  //   `${process.env.EMPTY_CART}/api/v1/get-cart`,
  //   {
  //     userId,
  //   },
  //   {
  //     headers: { ...errorHeaders, authorization: headers.authorization },
  //   }
  // );
  try {

    await axios.post(
      `${process.env.EMPTY_CART}/api/v1/get-cart`,
      { userId },
      {
        headers: { ...errorHeaders, authorization: headers.authorization },
        timeout: 3000
      }
    );

  } catch (error) {

    console.error("Cart service error:", error.message);

  }

  return res
    .status(200)
    .json(ordersWithProductDetails.filter((order) => order !== null));
};

const createOrders = async (req, res) => {
  const { userId, products, address, contactNo } = req.body;
  const headers = req.headers;

  const errorHeaders = {};
  if (headers["error-service"] && headers["error-code"]) {
    errorHeaders["error-service"] = headers["error-service"];
    errorHeaders["error-code"] = headers["error-code"];
  }

  if (!userId) {
    const error = new Error("No userId provided");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const userResponse = await axios.get(
    `${process.env.USER_RESPONSE}/api/v1/${userId}`,
    {
      headers: { ...errorHeaders },
    }
  );

  if (!userResponse.data) {
    const error = new Error("Invalid user");
    error.statusCode = 400;
    console.error(error.stack);
    throw error;
  }

  const invalidProducts = (
    await Promise.all(
      products.map(async (product) => {
        const productResponse = await axios.get(
          `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${product.productId}`,
          {
            headers: { ...errorHeaders },
          }
        );
        return productResponse.data ? null : product.productId;
      })
    )
  ).filter(Boolean);

  if (invalidProducts.length > 0) {
    return res.status(400).json({
      message: `Invalid products: ${invalidProducts.join(", ")}`,
      status: false,
    });
  }

  const totalAmount = (
    await Promise.all(
      products.map(async (product) => {
        try {
          const productResponse = await axios.get(
            `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${product.productId}`,
            {
              headers: { ...errorHeaders },
            }
          );

          return productResponse.data
            ? productResponse.data.price * product.quantity
            : null;
        } catch {
          return null;
        }
      })
    )
  ).reduce((total, amount) => total + (amount || 0), 0);

  const order = await Order.create({
    userId,
    products: JSON.stringify(products),
    address,
    contactNo,
    amount: totalAmount,
  });

  try {

    await axios.post(
      `${process.env.EMPTY_CART}/api/v1/delete-all-cart`,
      { userId },
      {
        headers: { ...errorHeaders },
        timeout: 3000
      }
    );

  } catch (error) {

    console.error("Cart cleanup failed:", error.message);

  }
  // await axios.post(
  //   `${process.env.EMPTY_CART}/api/v1/delete-all-cart`,
  //   {
  //     userId,
  //   },
  //   {
  //     headers: { ...errorHeaders },
  //   }
  // );

  return res.status(201).json({
    order: {
      id: order.id,
      userId: order.userId,
      address: order.address,
      contactNo: order.contactNo,
      amount: order.amount,
      date: order.date,
      products: order.products,
    },
    message: "Your Order Has Been Placed",
  });
};

module.exports = {
  getOrders: errorHandlerWrapper(getOrders),
  createOrders: errorHandlerWrapper(createOrders),
};

// const Order = require("../models/Order");
// const axios = require("axios");
// const env = require("dotenv").config();
// const newrelic = require("newrelic");
// const SERVICE = "orders";
// const sendEventToNewRelic = require("../event");

// const newRelicWrapper = (handler) => {
//   return async (req, res) => {
//     const errorCode = req.headers["error-code"];
//     const errorService = req.headers["error-service"];
//     if (errorCode && errorService && errorService == SERVICE) {
//       handleCustomError(errorCode, res);
//       return;
//     }
//     try {
//       await handler(req, res);
//     } catch (error) {
//       const statusCode = error.response?.status || error?.statusCode || 500;
//       console.log("Error in orders", error);
//       newrelic.noticeError(error, { context: statusCode });
//       return res.status(statusCode).json({
//         message: error.message,
//         error,
//         statusCode,
//       });
//     }
//   };
// };

// const handleCustomError = async (errorCode, res) => {
//   try {
//     let error;

//     switch (errorCode) {
//       case "501":
//         error = new Error("Not Implemented");
//         error.name = "NotImplementedError";
//         error.code = 501;
//         error.service = SERVICE;
//         error.details =
//           "This feature or endpoint has not been implemented yet.";
//         throw error;
//       case "502":
//         await simulateUpstreamServiceFailure();
//         break;
//       case "503":
//         simulateServerOverload();
//         break;
//       default:
//         error = new Error(`Unknown Error Code: ${errorCode}`);
//         error.name = "CustomError";
//         error.code = parseInt(errorCode, 10) || 400;
//         error.service = SERVICE;
//         throw error;
//     }
//   } catch (error) {
//     const statusCode = error.code || parseInt(errorCode, 10) || 400;

//     newrelic.noticeError(error, {
//       service: SERVICE,
//       errorCode: errorCode,
//       errorName: error.name || "CustomError",
//       errorMessage: error.message,
//       stack: error.stack,
//       timestamp: new Date().toISOString(),
//     });

//     console.error(error.stack);
//     res.status(statusCode).json({
//       message: error.message,
//       service: SERVICE,
//       errorCode: errorCode,
//       details: error.details || "An error occurred",
//     });
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

// const getOrders = async (req, res) => {
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

//   const orders = await Order.findAll({ where: { userId } });
//   const ordersWithProductDetails = await Promise.all(
//     orders.map(async (order) => {
//       const products = order.products;
//       try {
//         const parsedProducts = JSON.parse(JSON.parse(products));

//         const productsWithDetails = await Promise.all(
//           parsedProducts.map(async (product) => {
//             try {
//               const productResponse = await axios.get(
//                 `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${product.productId}`,
//                 {
//                   headers: { ...errorHeaders },
//                 }
//               );

//               if (productResponse.data) {
//                 return {
//                   productId: product.productId,
//                   title: productResponse.data.title,
//                   description: productResponse.data.description,
//                   image: productResponse.data.image,
//                   quantity: product.quantity,
//                   price: productResponse.data.price,
//                 };
//               } else {
//                 return null;
//               }
//             } catch (error) {
//               return {
//                 title: "Product Not Found",
//                 description: "Product details could not be retrieved",
//                 image: null,
//                 quantity: product.quantity,
//                 price: null,
//               };
//             }
//           })
//         );

//         return {
//           orderId: order.id,
//           userId: order.userId,
//           address: order.address,
//           contactNo: order.contactNo,
//           amount: order.price,
//           date: order.date,
//           products: productsWithDetails.filter((p) => p !== null),
//         };
//       } catch (parseError) {
//         console.error("Error parsing products field:", parseError);
//         return null;
//       }
//     })
//   );

//   await axios.post(
//     `${process.env.EMPTY_CART}/api/v1/get-cart`,
//     {
//       userId,
//     },
//     {
//       headers: { ...errorHeaders, authorization: headers.authorization },
//     }
//   );

//   return res
//     .status(200)
//     .json(ordersWithProductDetails.filter((order) => order !== null));
// };

// const createOrders = async (req, res) => {
//   const { userId, products, address, contactNo } = req.body;
//   const headers = req.headers;
//   const errorHeaders = {};
//   if (headers["error-service"] && headers["error-code"]) {
//     errorHeaders["error-service"] = headers["error-service"];
//     errorHeaders["error-code"] = headers["error-code"];
//   }

//   if (!userId) {
//     const error = new Error("No userId provided");
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

//   const invalidProducts = (
//     await Promise.all(
//       products.map(async (product) => {
//         const productResponse = await axios.get(
//           `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${product.productId}`,
//           {
//             headers: { ...errorHeaders },
//           }
//         );
//         return productResponse.data ? null : product.productId;
//       })
//     )
//   ).filter(Boolean);

//   if (invalidProducts.length > 0) {
//     return res.status(400).json({
//       message: `Invalid products: ${invalidProducts.join(", ")}`,
//       status: false,
//     });
//   }

//   const totalAmount = (
//     await Promise.all(
//       products.map(async (product) => {
//         try {
//           const productResponse = await axios.get(
//             `${process.env.PRODUCT_RESPONSE}/api/v1/products/check/${product.productId}`,
//             {
//               headers: { ...errorHeaders },
//             }
//           );

//           return productResponse.data
//             ? productResponse.data.price * product.quantity
//             : null;
//         } catch (error) {
//           return null;
//         }
//       })
//     )
//   ).reduce((total, amount) => total + (amount || 0), 0);

//   const order = await Order.create({
//     userId,
//     products: JSON.stringify(products),
//     address,
//     contactNo,
//     amount: totalAmount,
//   });

//   // ✅ Send event to New Relic
//   Promise.allSettled([
//     sendEventToNewRelic(
//       {
//         userId: order.userId,
//         orderId: order.id,
//         timestamp: Date.now(),
//         total_amount: totalAmount,
//         createdAt: order.createdAt,
//         log_type: "order_event",
//         event_type: "orders/totalAmount",
//       },
//       "OrderEvent"
//     ),
//     sendEventToNewRelic(
//       {
//         userId: order.userId,
//         orderId: order.id,
//         timestamp: Date.now(),
//         amount: totalAmount,
//         products: order.products,
//         address: order.address,
//         contactNo: order.contactNo,
//         createdAt: order.createdAt,
//         log_type: "order_event",
//         event_type: "orders/create",
//         status: "created",
//       },
//       "OrderEvent"
//     ),
//   ])
//     .then((results) => {
//       results.forEach((r, idx) => {
//         if (r.status === "fulfilled") {
//           console.log(`✅ Event ${idx + 1} sent successfully`);
//         } else {
//           console.error(
//             `❌ Event ${idx + 1} failed:`,
//             r.reason?.message || r.reason
//           );
//         }
//       });
//     })
//     .catch((err) => {
//       console.error("Unexpected error while sending events:", err.message);
//     });

//   await axios.post(
//     `${process.env.EMPTY_CART}/api/v1/delete-all-cart`,
//     {
//       userId,
//     },
//     {
//       headers: { ...errorHeaders },
//     }
//   );
//   return res.status(201).json({
//     order: {
//       id: order.id,
//       userId: order.userId,
//       address: order.address,
//       contactNo: order.contactNo,
//       amount: order.amount,
//       date: order.date,
//       products: order.products,
//     },
//     message: "Your Order Has Been Placed",
//   });
// };

// module.exports = {
//   getOrders: newRelicWrapper(getOrders),
//   createOrders: newRelicWrapper(createOrders),
// };
