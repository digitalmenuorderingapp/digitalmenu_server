const { Server } = require('socket.io');

/**
 * Socket Service - Manages Socket.IO server and event handlers
 */
class SocketService {
  constructor() {
    this.io = null;
  }

  /**
   * Initialize Socket.IO with HTTP server
   * @param {http.Server} server - HTTP server instance
   * @param {Function} checkOrigin - CORS origin check function
   * @returns {Server} Socket.IO server instance
   */
  init(server, checkOrigin) {
    this.io = new Server(server, {
      cors: {
        origin: checkOrigin,
        credentials: true,
        methods: ['GET', 'POST']
      },
      transports: ['polling', 'websocket'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    this.setupEventHandlers();
    return this.io;
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[Socket] New client connected: ${socket.id}`);
      
      // Handle join room
      socket.on('join', (room) => {
        socket.join(room);
      });

      // Handle menu updates from admin and broadcast to restaurant customers
      socket.on('menuUpdated', (data) => {
        if (data && data.restaurantId) {
          // Broadcast to all sockets in the restaurant room
          this.io.to(`restaurant:${data.restaurantId}`).emit('menuUpdated', { restaurantId: data.restaurantId });
          console.log(`[Socket] Menu updated broadcast to restaurant: ${data.restaurantId}`);
        }
      });

      socket.on('disconnect', () => {
        // Client disconnected
      });
    });
  }

  /**
   * Get Socket.IO instance
   * @returns {Server|null} Socket.IO server instance
   */
  getIO() {
    return this.io;
  }

  /**
   * Emit event to all clients in a room
   * @param {string} room - Room ID
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  emitToRoom(room, event, data) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }

  /**
   * Broadcast event to all connected clients
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  broadcast(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}

// Export singleton instance
module.exports = new SocketService();
