CREATE TABLE "aiextraction"."bill_of_lading_goods_description_items" (
    "id" TEXT NOT NULL,
    "bill_of_lading_id" TEXT NOT NULL,
    "product_code" TEXT,
    "product_description" TEXT,
    "product_specification" TEXT,
    "product_marks" TEXT,

    CONSTRAINT "bill_of_lading_goods_description_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "aiextraction"."bill_of_lading_goods_description_items"
ADD CONSTRAINT "bill_of_lading_goods_description_items_bill_of_lading_id_fkey"
FOREIGN KEY ("bill_of_lading_id")
REFERENCES "aiextraction"."bills_of_lading"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE INDEX "bill_of_lading_goods_description_items_bill_of_lading_id_idx"
ON "aiextraction"."bill_of_lading_goods_description_items"("bill_of_lading_id");
