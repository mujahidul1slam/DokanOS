import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ProductList from "@/components/products/ProductList";
import CategoriesTab from "@/components/products/CategoriesTab";

const Products = () => {
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl font-semibold">Products</h1>
      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">All Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductList />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Products;
