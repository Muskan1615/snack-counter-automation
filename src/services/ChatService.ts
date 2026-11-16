/**
 * ChatService — simulated stand-in for a real chat tool (Slack, Teams, etc.)
 *
 * In production this would call the Slack API or similar.
 * Here it just logs messages and stores them so tests can assert on them.
 */

import { ChatMessage } from '../types.js';

export class ChatService {
  private log: ChatMessage[] = [];

  /**
   * Send a notification to a volunteer.
   */
  sendMessage(volunteerId: string, message: string): void {
    const msg: ChatMessage = {
      to: volunteerId,
      message,
      sentAt: new Date(),
    };
    this.log.push(msg);
    console.log(`[Chat → ${volunteerId}] ${message}`);
  }

  /**
   * Return all messages sent so far (for testing).
   */
  getMessages(): ChatMessage[] {
    return [...this.log];
  }

  /**
   * Return messages sent to a specific volunteer.
   */
  getMessagesFor(volunteerId: string): ChatMessage[] {
    return this.log.filter((m) => m.to === volunteerId);
  }

  /**
   * Clear the log (useful between tests).
   */
  clear(): void {
    this.log = [];
  }
}
