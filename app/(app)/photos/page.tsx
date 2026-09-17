import { PhotoWall } from "@/components/photos/PhotoWall";

export const dynamic = "force-dynamic";

export default function PhotosPage() {
  return (
    <section aria-label="相册">
      <h1 className="mb-3 font-(--font-serif-cn) text-lg">相册</h1>
      <PhotoWall />
    </section>
  );
}
