
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertTransactionSchema, type InsertTransaction, type Customer, type Product } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, QrCode, Search, Receipt } from "lucide-react";

interface InvoiceFormProps {
  open: boolean;
  onClose: () => void;
}

interface TransactionItem {
  id: string;
  transactionId: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
}

export default function InvoiceForm({ open, onClose }: InvoiceFormProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [lastScannedBarcode, setLastScannedBarcode] = useState("");

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products", productSearch],
    retry: false,
  });

  const { data: scannedProduct, isLoading: barcodeLoading } = useQuery<Product>({
    queryKey: ["/api/products/barcode", lastScannedBarcode],
    enabled: !!lastScannedBarcode,
    retry: false,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    retry: false,
  });

  const form = useForm<InsertTransaction>({
    resolver: zodResolver(insertTransactionSchema),
    defaultValues: {
      customerName: "",
      discount: "0",
      paymentType: "cash",
      currency: "TRY",
    },
  });

  const createTransactionMutation = useMutation({
    mutationFn: async ({ transactionData, items }: { transactionData: InsertTransaction; items: TransactionItem[] }) => {
      console.log("Sending transaction data:", { transaction: transactionData, items });
      
      // التحقق من صحة البيانات قبل الإرسال
      if (!transactionData || !items || items.length === 0) {
        throw new Error("بيانات الفاتورة غير مكتملة");
      }

      const response = await apiRequest("POST", "/api/transactions", { 
        transaction: transactionData, 
        items: items.map(item => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
          total: item.total
        }))
      });
      
      return response;
    },
    onSuccess: (response) => {
      console.log("Transaction created successfully:", response);
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      toast({
        title: "تم بنجاح",
        description: "تم إنشاء الفاتورة بنجاح",
      });
      form.reset();
      setItems([]);
      setSelectedCustomer(null);
      setCustomerSearch("");
      setProductSearch("");
      setBarcodeInput("");
      setLastScannedBarcode("");
      onClose();
    },
    onError: (error: any) => {
      console.error("Transaction creation error:", error);
      console.error("Error details:", {
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        data: error?.response?.data,
        message: error?.message
      });
      
      let errorMessage = "فشل في إنشاء الفاتورة";
      
      if (error?.response?.status === 500) {
        errorMessage = "خطأ في الخادم. يرجى المحاولة مرة أخرى";
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      toast({
        title: "خطأ في إنشاء الفاتورة",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const addItem = (product: Product) => {
    const existingItem = items.find(item => item.productId === product.id);

    if (existingItem) {
      setItems(items.map(item => 
        item.productId === product.id 
          ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
          : item
      ));
    } else {
      const newItem: TransactionItem = {
        id: crypto.randomUUID(),
        transactionId: "",
        productId: product.id,
        productName: product.name,
        quantity: 1,
        price: parseFloat(product.price),
        total: parseFloat(product.price),
      };
      setItems([...items, newItem]);
    }
  };

  const handleBarcodeSearch = () => {
    if (!barcodeInput.trim()) return;
    setLastScannedBarcode(barcodeInput.trim());
  };

  const handleBarcodeKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBarcodeSearch();
    }
  };

  // Auto-add product when barcode is scanned
  React.useEffect(() => {
    if (scannedProduct) {
      addItem(scannedProduct);
      setBarcodeInput("");
      setLastScannedBarcode("");
    }
  }, [scannedProduct]);

  // Auto-fill customer name when customer is selected
  React.useEffect(() => {
    if (selectedCustomer) {
      form.setValue("customerName", selectedCustomer.name);
    }
  }, [selectedCustomer, form]);

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const discount = parseFloat(form.watch("discount") || "0");
    const total = subtotal - discount;

    return { subtotal, discount, total };
  };

  const getCurrencySymbol = (currency: string) => {
    return currency === "USD" ? "$" : "₺";
  };
  
  const onSubmit = async (data: InsertTransaction) => {
    console.log("Form submitted with data:", data);
    console.log("Items:", items);

    if (items.length === 0) {
      toast({
        title: "خطأ",
        description: "يجب إضافة منتج واحد على الأقل",
        variant: "destructive",
      });
      return;
    }

    const { total } = calculateTotals();

    // التأكد من أن جميع القيم مطلوبة موجودة
    const transactionData: InsertTransaction = {
      customerName: selectedCustomer?.name || data.customerName || "عميل غير محدد",
      total: total.toString(),
      discount: data.discount || "0",
      tax: "0",
      paymentType: data.paymentType || "cash",
      currency: data.currency || "TRY",
      customerId: selectedCustomer?.id || null,
      status: "completed",
      transactionType: "sale" as const,
    };

    console.log("Final transaction data:", transactionData);

    // التحقق من صحة البيانات قبل الإرسال
    if (!transactionData.customerName || transactionData.customerName.trim() === "") {
      toast({
        title: "خطأ",
        description: "يجب إدخال اسم العميل",
        variant: "destructive",
      });
      return;
    }

    if (total <= 0) {
      toast({
        title: "خطأ",
        description: "المجموع يجب أن يكون أكبر من الصفر",
        variant: "destructive",
      });
      return;
    }

    createTransactionMutation.mutate({ transactionData, items });
  };

  const totals = calculateTotals();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-6xl h-[95vh] flex flex-col" aria-describedby="invoice-description">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-right flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            إنشاء فاتورة جديدة
          </DialogTitle>
          <div id="invoice-description" className="sr-only">
            نموذج إنشاء فاتورة جديدة مع إضافة المنتجات والعملاء
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Barcode Scanner */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <QrCode className="h-4 w-4" />
                  قراءة سريعة بالباركود
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="امسح أو أدخل الباركود..."
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={handleBarcodeKeyPress}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={handleBarcodeSearch}
                    disabled={barcodeLoading || !barcodeInput.trim()}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {barcodeLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {lastScannedBarcode && !scannedProduct && !barcodeLoading && (
                  <p className="text-sm text-red-600 mt-2">لم يتم العثور على المنتج</p>
                )}
              </CardContent>
            </Card>

            {/* Customer Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">معلومات العميل</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm">اختيار عميل موجود</Label>
                    <Select onValueChange={(value) => {
                      const customer = customers.find((c) => c.id === value) || null;
                      setSelectedCustomer(customer);
                      if (customer) {
                        form.setValue("customerName", customer.name);
                      }
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر عميل" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers
                          .filter((customer) => customer.name.toLowerCase().includes(customerSearch.toLowerCase()))
                          .map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="search"
                      placeholder="ابحث عن عميل..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="customerName" className="text-sm">اسم العميل</Label>
                    <Input
                      id="customerName"
                      placeholder="أدخل اسم العميل أو اختر من القائمة"
                      {...form.register("customerName")}
                      className="text-right"
                      value={selectedCustomer?.name || form.watch("customerName") || ""}
                      onChange={(e) => {
                        if (!selectedCustomer) {
                          form.setValue("customerName", e.target.value);
                        }
                      }}
                      readOnly={!!selectedCustomer}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm">العملة</Label>
                    <Select 
                      value={form.watch("currency")} 
                      onValueChange={(value) => form.setValue("currency", value as "TRY" | "USD")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر العملة" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TRY">ليرة تركية (₺)</SelectItem>
                        <SelectItem value="USD">دولار أمريكي ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">نوع الدفع</Label>
                    <Select 
                      value={form.watch("paymentType")} 
                      onValueChange={(value) => form.setValue("paymentType", value as "cash" | "credit")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر نوع الدفع" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">نقد</SelectItem>
                        <SelectItem value="credit">دين</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Product Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">المنتجات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Input
                    type="search"
                    placeholder="ابحث عن منتج..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                    {products
                      .filter((product) => product.name.toLowerCase().includes(productSearch.toLowerCase()))
                      .map((product) => (
                        <Button
                          key={product.id}
                          type="button"
                          variant="outline"
                          className="justify-start text-xs h-auto p-2"
                          onClick={() => addItem(product)}
                        >
                          <div className="text-right">
                            <div className="font-medium">{product.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {product.price} {getCurrencySymbol(form.watch("currency") || "TRY")}
                            </div>
                          </div>
                        </Button>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Items */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">العناصر المضافة</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between border rounded-md p-3">
                      <span className="text-sm font-medium">
                        {item.productName} × {item.quantity}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {item.total.toFixed(2)} {getCurrencySymbol(form.watch("currency") || "TRY")}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-red-500 hover:bg-red-50 h-8 w-8 p-0"
                          onClick={() => setItems(items.filter((i) => i.id !== item.id))}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-4">
                      لا توجد عناصر مضافة. استخدم البحث أو الباركود لإضافة المنتجات.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Totals */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">الإجماليات</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="discount" className="text-sm">الخصم (اختياري)</Label>
                  <Input
                    id="discount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    {...form.register("discount")}
                  />
                </div>

                <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>المجموع الفرعي:</span>
                    <span className="font-medium">{totals.subtotal.toFixed(2)} {getCurrencySymbol(form.watch("currency") || "TRY")}</span>
                  </div>
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>الخصم:</span>
                      <span className="font-medium text-red-600">-{totals.discount.toFixed(2)} {getCurrencySymbol(form.watch("currency") || "TRY")}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>المجموع النهائي:</span>
                    <span className="text-blue-600">{totals.total.toFixed(2)} {getCurrencySymbol(form.watch("currency") || "TRY")}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          {/* Action Buttons - Inside form */}
            <div className="flex gap-3 pt-4 border-t bg-white">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                إلغاء
              </Button>
              <Button 
                type="submit"
                disabled={createTransactionMutation.isPending || items.length === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                onClick={(e) => {
                  console.log("Submit button clicked");
                  console.log("Items count:", items.length);
                  console.log("Form data:", form.getValues());
                  console.log("Mutation pending:", createTransactionMutation.isPending);
                  
                  if (items.length === 0) {
                    e.preventDefault();
                    toast({
                      title: "خطأ",
                      description: "يجب إضافة منتج واحد على الأقل",
                      variant: "destructive",
                    });
                  }
                }}
              >
                {createTransactionMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                    جارٍ الإنشاء...
                  </>
                ) : (
                  <>
                    <Receipt className="h-4 w-4 ml-2" />
                    إنشاء الفاتورة ({items.length} عنصر)
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
