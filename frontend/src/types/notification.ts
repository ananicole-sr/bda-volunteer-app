export type NotificationType =
  | 'check_in'
  | 'reward'
  | 'low_stock';

export interface AdminNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
}