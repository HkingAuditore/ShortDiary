import { PhotoWall } from "@/components/photos/PhotoWall";
import { HandNote } from "@/components/paper/PaperCard";

export const dynamic = "force-dynamic";

export default function PhotosPage() {
  return (
    <section aria-label="相册">
      <h1 className="mb-1 font-(--font-serif-cn) text-lg">
        相册
        <HandNote className="ml-2 text-xs">散落一桌的拍立得</HandNote>
      </h1>
      <div className="mb-5">
        <PhotoWall />
      </div>
    </section>
  );
}
