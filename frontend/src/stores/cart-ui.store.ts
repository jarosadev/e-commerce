import { create } from 'zustand';

interface CartItem {
  productId: string;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  addItem: (productId: string) => void;
  removeItem: (productId: string) => void;
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  addItem: (productId) => set((state) => ({
    items: [...state.items, { productId, quantity: 1 }]
  })),
  removeItem: (productId) => set((state) => ({
    items: state.items.filter((item) => item.productId !== productId)
  })),
}));
