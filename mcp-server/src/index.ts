import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Pool, types } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Parse dates as strings instead of Date objects
types.setTypeParser(types.builtins.DATE, (val: string) => val);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:password@localhost:5432/kitchenai",
});

// Define tools
const tools: Tool[] = [
  {
    name: "get_inventory",
    description: "Get all items in the inventory",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_expiring_items",
    description: "Get items that are expiring soon (within 3 days)",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "update_stock",
    description: "Update the quantity of an inventory item",
    inputSchema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "ID of the item to update",
        },
        qty: {
          type: "number",
          description: "New quantity",
        },
        unit: {
          type: "string",
          description: "Unit of measurement (optional, defaults to existing unit)",
        },
      },
      required: ["item_id", "qty"],
    },
  },
  {
    name: "add_inventory_item",
    description: "Add a new item to the inventory",
    inputSchema: {
      type: "object",
      properties: {
        canonical_name: {
          type: "string",
          description: "Name of the item (e.g., 'Milk', 'Tomato')",
        },
        qty: {
          type: "number",
          description: "Quantity",
        },
        unit: {
          type: "string",
          description: "Unit of measurement (e.g., 'liters', 'pieces', 'grams')",
        },
        estimated_expiry: {
          type: "string",
          description: "Estimated expiry date in YYYY-MM-DD format (optional)",
        },
        is_manual: {
          type: "boolean",
          description: "Whether this was manually added (default: true)",
        },
      },
      required: ["canonical_name", "qty", "unit"],
    },
  },
  {
    name: "get_cook_profile",
    description: "Get the cook's profile including known dishes and language preference",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_user_preferences",
    description: "Get user's dietary preferences and dislikes",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "suggest_rescue_meal",
    description: "Suggest a meal based on expiring items and cook's skills",
    inputSchema: {
      type: "object",
      properties: {
        max_items: {
          type: "number",
          description: "Maximum number of expiring items to consider (default: 3)",
        },
      },
      required: [],
    },
  },
  {
    name: "scan_bill",
    description: "Scan a grocery bill image using Gemini AI to extract items and add to inventory",
    inputSchema: {
      type: "object",
      properties: {
        image_data: {
          type: "string",
          description: "Base64 encoded image data of the grocery bill",
        },
        image_type: {
          type: "string",
          description: "MIME type of the image (e.g., 'image/jpeg', 'image/png')",
        },
        test_mode: {
          type: "boolean",
          description: "If true, returns mock data without calling Gemini API (for testing)",
        },
      },
      required: ["image_data"],
    },
  },
  {
    name: "send_whatsapp_message",
    description: "Send a WhatsApp message to the cook or user",
    inputSchema: {
      type: "object",
      properties: {
        phone_number: {
          type: "string",
          description: "Phone number to send message to (with country code, e.g., +919876543210)",
        },
        message: {
          type: "string",
          description: "Message content to send",
        },
        test_mode: {
          type: "boolean",
          description: "If true, simulates sending without actually sending (for testing)",
        },
      },
      required: ["phone_number", "message"],
    },
  },
  {
    name: "send_meal_suggestion_to_cook",
    description: "Send a meal suggestion to the cook in their preferred language",
    inputSchema: {
      type: "object",
      properties: {
        meal_name: {
          type: "string",
          description: "Name of the meal (e.g., 'Paneer Butter Masala')",
        },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
            },
            required: ["name", "quantity", "unit"],
          },
          description: "List of ingredients with quantities",
        },
        cooking_time: {
          type: "number",
          description: "Cooking time in minutes",
        },
        test_mode: {
          type: "boolean",
          description: "If true, simulates sending without actually sending (for testing)",
        },
      },
      required: ["meal_name", "ingredients", "cooking_time"],
    },
  },
  {
    name: "send_daily_menu_to_cook",
    description: "Send the approved daily menu to the cook",
    inputSchema: {
      type: "object",
      properties: {
        menu: {
          type: "array",
          items: {
            type: "object",
            properties: {
              meal_name: { type: "string" },
              meal_time: { type: "string", description: "e.g., 'breakfast', 'lunch', 'dinner'" },
            },
            required: ["meal_name"],
          },
          description: "List of meals for the day",
        },
        test_mode: {
          type: "boolean",
          description: "If true, simulates sending without actually sending (for testing)",
        },
      },
      required: ["menu"],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: "kitchenai-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
  }
);

// Tool: get_inventory
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Tool: get_inventory
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_inventory": {
        const result = await pool.query(
          "SELECT item_id, canonical_name, qty, unit, estimated_expiry, is_manual FROM inventory ORDER BY created_at DESC"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows, null, 2),
            },
          ],
        };
      }

      case "get_expiring_items": {
        const result = await pool.query(`
          SELECT 
            item_id, 
            canonical_name, 
            qty, 
            unit, 
            estimated_expiry,
            DATE_PART('day', estimated_expiry - CURRENT_DATE)::integer as days_until_expiry
          FROM inventory 
          WHERE estimated_expiry IS NOT NULL 
            AND estimated_expiry >= CURRENT_DATE
            AND estimated_expiry <= CURRENT_DATE + INTERVAL '3 days'
          ORDER BY estimated_expiry ASC
        `);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows, null, 2),
            },
          ],
        };
      }

      case "update_stock": {
        const { item_id, qty, unit } = args as any;
        let query = "UPDATE inventory SET qty = $1";
        const params: any[] = [qty];

        if (unit) {
          query += ", unit = $2 WHERE item_id = $3";
          params.push(unit, item_id);
        } else {
          query += " WHERE item_id = $2";
          params.push(item_id);
        }

        const result = await pool.query(query, params);
        
        if (result.rowCount === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Item with ID ${item_id} not found`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated item ${item_id} to quantity ${qty}${unit ? ` ${unit}` : ''}`,
            },
          ],
        };
      }

      case "add_inventory_item": {
        const { canonical_name, qty, unit, estimated_expiry, is_manual = true } = args as any;
        
        let query = `
          INSERT INTO inventory (canonical_name, qty, unit, estimated_expiry, is_manual)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING item_id, canonical_name, qty, unit, estimated_expiry, is_manual
        `;
        
        const params = [canonical_name, qty, unit, estimated_expiry || null, is_manual];
        
        const result = await pool.query(query, params);
        
        return {
          content: [
            {
              type: "text",
              text: `Added item: ${JSON.stringify(result.rows[0], null, 2)}`,
            },
          ],
        };
      }

      case "get_cook_profile": {
        const result = await pool.query(
          "SELECT cook_id, dishes_known, preferred_lang, phone_number FROM cook_profile LIMIT 1"
        );
        
        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No cook profile found. Using default profile.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows[0], null, 2),
            },
          ],
        };
      }

      case "get_user_preferences": {
        const result = await pool.query(
          "SELECT user_id, dislikes, dietary_tags, fav_cuisines FROM user_prefs LIMIT 1"
        );
        
        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No user preferences found. Using default preferences.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows[0], null, 2),
            },
          ],
        };
      }

      case "suggest_rescue_meal": {
        const { max_items = 3 } = args as any;
        
        // Get expiring items
        const expiringResult = await pool.query(`
          SELECT 
            canonical_name,
            qty,
            unit
          FROM inventory 
          WHERE estimated_expiry IS NOT NULL 
            AND estimated_expiry >= CURRENT_DATE
            AND estimated_expiry <= CURRENT_DATE + INTERVAL '3 days'
          ORDER BY estimated_expiry ASC
          LIMIT $1
        `, [max_items]);

        // Get cook's known dishes
        const cookResult = await pool.query(
          "SELECT dishes_known FROM cook_profile LIMIT 1"
        );

        const expiringItems = expiringResult.rows;
        const dishesKnown = cookResult.rows[0]?.dishes_known || [];

        if (expiringItems.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No items expiring soon. No rescue meal needed.",
              },
            ],
          };
        }

        // Simple meal suggestion logic
        const itemsList = expiringItems.map(item => `${item.canonical_name} (${item.qty} ${item.unit})`).join(', ');
        
        let suggestion = `Based on expiring items: ${itemsList}\n\n`;
        
        if (dishesKnown.length > 0) {
          suggestion += `Cook knows: ${dishesKnown.join(', ')}\n\n`;
          suggestion += `Suggested meal: ${dishesKnown[0]} using ${expiringItems[0].canonical_name}`;
        } else {
          suggestion += `Suggested meal: Simple stir-fry using ${expiringItems.map(item => item.canonical_name).join(', ')}`;
        }

        return {
          content: [
            {
              type: "text",
              text: suggestion,
            },
          ],
        };
      }

      case "scan_bill": {
        const { image_data, image_type, test_mode } = args as {
          image_data: string;
          image_type?: string;
          test_mode?: boolean;
        };

        // For testing, return mock data
        if (test_mode) {
          const mockItems = [
            { name: "Basmati Rice", quantity: 5, unit: "kg", price_per_unit: 120, total_price: 600 },
            { name: "Tomatoes", quantity: 2, unit: "kg", price_per_unit: 40, total_price: 80 },
            { name: "Onions", quantity: 3, unit: "kg", price_per_unit: 30, total_price: 90 },
          ];

          // Add mock items to inventory
          for (const item of mockItems) {
            await pool.query(
              `INSERT INTO inventory (canonical_name, qty, unit, is_manual, created_at, updated_at)
               VALUES ($1, $2, $3, false, NOW(), NOW())
               ON CONFLICT (canonical_name, unit)
               DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = NOW()`,
              [item.name, item.quantity, item.unit]
            );
          }

          return {
            content: [
              {
                type: "text",
                text: `Test mode: Successfully scanned bill and added ${mockItems.length} items to inventory:\n${JSON.stringify(mockItems, null, 2)}`,
              },
            ],
          };
        }

        // Call the backend API for real scanning
        const backendUrl = process.env.BACKEND_URL || "http://localhost:8080";
        const response = await fetch(`${backendUrl}/api/v1/bill/scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image_data,
            image_type: image_type || "image/jpeg",
          }),
        });

        if (!response.ok) {
          throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return {
          content: [
            {
              type: "text",
              text: `Successfully scanned bill:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "send_whatsapp_message": {
        const { phone_number, message, test_mode } = args as {
          phone_number: string;
          message: string;
          test_mode?: boolean;
        };

        const backendUrl = process.env.BACKEND_URL || "http://localhost:8080";
        
        if (test_mode) {
          return {
            content: [
              {
                type: "text",
                text: `[TEST MODE] Would send WhatsApp message to ${phone_number}:\n${message}`,
              },
            ],
          };
        }

        // Call backend WhatsApp API
        const response = await fetch(`${backendUrl}/api/v1/whatsapp/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            phone_number,
            message,
          }),
        });

        if (!response.ok) {
          throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return {
          content: [
            {
              type: "text",
              text: `WhatsApp message sent successfully: ${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "send_meal_suggestion_to_cook": {
        const { meal_name, ingredients, cooking_time, test_mode } = args as {
          meal_name: string;
          ingredients: any[];
          cooking_time: number;
          test_mode?: boolean;
        };

        const backendUrl = process.env.BACKEND_URL || "http://localhost:8080";
        
        if (test_mode) {
          const ingredientsText = ingredients.map((ing: any) =>
            `${ing.name}: ${ing.quantity} ${ing.unit}`
          ).join('\n');
          
          return {
            content: [
              {
                type: "text",
                text: `[TEST MODE] Would send meal suggestion to cook:\n\nMeal: ${meal_name}\n\nIngredients:\n${ingredientsText}\n\nCooking Time: ${cooking_time} minutes`,
              },
            ],
          };
        }

        // Call backend meal suggestion API
        const response = await fetch(`${backendUrl}/api/v1/whatsapp/send-meal-suggestion`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            meal_name,
            ingredients,
            cooking_time,
          }),
        });

        if (!response.ok) {
          throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return {
          content: [
            {
              type: "text",
              text: `Meal suggestion sent to cook successfully: ${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      case "send_daily_menu_to_cook": {
        const { menu, test_mode } = args as {
          menu: any[];
          test_mode?: boolean;
        };

        const backendUrl = process.env.BACKEND_URL || "http://localhost:8080";
        
        if (test_mode) {
          const menuText = menu.map((item: any, index: number) =>
            `${index + 1}. ${item.meal_name} (${item.meal_time || 'meal'})`
          ).join('\n');
          
          return {
            content: [
              {
                type: "text",
                text: `[TEST MODE] Would send daily menu to cook:\n\nDaily Menu:\n${menuText}`,
              },
            ],
          };
        }

        // Call backend daily menu API
        const response = await fetch(`${backendUrl}/api/v1/whatsapp/send-daily-menu`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            menu,
          }),
        });

        if (!response.ok) {
          throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        return {
          content: [
            {
              type: "text",
              text: `Daily menu sent to cook successfully: ${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Kitchen AI MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});